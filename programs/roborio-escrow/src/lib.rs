use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7B1g1XwsuvyZcniwp2FaKiMyFhicJNo97znvHimmxxcC");

#[program]
pub mod roborio_escrow {
    use super::*;

    /// Initialize a new rental escrow
    /// Renter deposits SOL into escrow PDA
    pub fn create_rental(
        ctx: Context<CreateRental>,
        robot_id: String,
        amount: u64,
        rental_duration_hours: u64,
    ) -> Result<()> {
        let escrow_key = ctx.accounts.escrow.key();
        let escrow_account_info = ctx.accounts.escrow.to_account_info();
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validate inputs
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(rental_duration_hours > 0, EscrowError::InvalidDuration);
        // Solana PDA seeds are limited to 32 bytes each
        require!(robot_id.len() > 0 && robot_id.len() <= 32, EscrowError::InvalidRobotId);

        // Initialize escrow state
        escrow.renter = ctx.accounts.renter.key();
        escrow.operator = ctx.accounts.operator.key();
        escrow.robot_id = robot_id;
        escrow.amount = amount;
        escrow.created_at = clock.unix_timestamp;

        // Calculate expiry with overflow protection
        let duration_seconds = rental_duration_hours
            .checked_mul(3600)
            .ok_or(EscrowError::InvalidDuration)?;
        let duration_i64 = i64::try_from(duration_seconds)
            .map_err(|_| EscrowError::InvalidDuration)?;
        escrow.expires_at = clock.unix_timestamp
            .checked_add(duration_i64)
            .ok_or(EscrowError::InvalidDuration)?;

        escrow.status = EscrowStatus::Active;
        escrow.bump = ctx.bumps.escrow;

        // Transfer SOL from renter to escrow PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.renter.to_account_info(),
                to: escrow_account_info,
            },
        );
        system_program::transfer(cpi_context, amount)?;

        emit!(RentalCreated {
            escrow: escrow_key,
            renter: escrow.renter,
            operator: escrow.operator,
            robot_id: escrow.robot_id.clone(),
            amount: escrow.amount,
            expires_at: escrow.expires_at,
        });

        Ok(())
    }

    /// Complete rental - release funds to operator
    /// Can only be called by renter after service is completed
    pub fn complete_rental(ctx: Context<CompleteRental>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        // Validate escrow state
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
        require!(escrow.renter == ctx.accounts.renter.key(), EscrowError::Unauthorized);

        // Calculate platform fee (2%)
        let platform_fee = escrow.amount / 50; // 2%

        // Get available funds
        let escrow_lamports = escrow.to_account_info().lamports();
        let rent_exempt = Rent::get()?.minimum_balance(Escrow::SPACE);
        let available = escrow_lamports.saturating_sub(rent_exempt);

        // Transfer platform fee first (if platform account provided)
        let mut remaining = available;
        if let Some(platform) = &ctx.accounts.platform {
            let fee_to_transfer = platform_fee.min(remaining);
            if fee_to_transfer > 0 {
                **escrow.to_account_info().try_borrow_mut_lamports()? -= fee_to_transfer;
                **platform.to_account_info().try_borrow_mut_lamports()? += fee_to_transfer;
                remaining = remaining.saturating_sub(fee_to_transfer);
            }
        }

        // Transfer remaining to operator
        if remaining > 0 {
            **escrow.to_account_info().try_borrow_mut_lamports()? -= remaining;
            **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += remaining;
        }

        // Update status
        escrow.status = EscrowStatus::Completed;

        emit!(RentalCompleted {
            escrow: escrow.key(),
            renter: escrow.renter,
            operator: escrow.operator,
            amount: remaining,
        });

        Ok(())
    }

    /// Cancel rental and refund renter
    /// Can be called by renter before service starts, or by operator anytime
    pub fn cancel_rental(ctx: Context<CancelRental>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let signer = ctx.accounts.signer.key();

        // Validate escrow state
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
        require!(
            signer == escrow.renter || signer == escrow.operator,
            EscrowError::Unauthorized
        );

        // Refund renter
        let escrow_lamports = escrow.to_account_info().lamports();
        let rent_exempt = Rent::get()?.minimum_balance(Escrow::SPACE);
        let refund_amount = escrow_lamports.saturating_sub(rent_exempt);

        **escrow.to_account_info().try_borrow_mut_lamports()? -= refund_amount;
        **ctx.accounts.renter.to_account_info().try_borrow_mut_lamports()? += refund_amount;

        // Update status
        escrow.status = EscrowStatus::Cancelled;

        emit!(RentalCancelled {
            escrow: escrow.key(),
            renter: escrow.renter,
            refund_amount,
        });

        Ok(())
    }

    /// Claim expired escrow - operator can claim after expiry if renter didn't complete
    pub fn claim_expired(ctx: Context<ClaimExpired>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validate
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
        require!(clock.unix_timestamp > escrow.expires_at, EscrowError::NotExpired);
        require!(escrow.operator == ctx.accounts.operator.key(), EscrowError::Unauthorized);

        // Transfer to operator (service assumed completed if time expired)
        let escrow_lamports = escrow.to_account_info().lamports();
        let rent_exempt = Rent::get()?.minimum_balance(Escrow::SPACE);
        let claim_amount = escrow_lamports.saturating_sub(rent_exempt);

        **escrow.to_account_info().try_borrow_mut_lamports()? -= claim_amount;
        **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += claim_amount;

        // Update status
        escrow.status = EscrowStatus::Expired;

        emit!(RentalExpired {
            escrow: escrow.key(),
            operator: escrow.operator,
            amount: claim_amount,
        });

        Ok(())
    }

    /// Close escrow account and recover rent
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;

        // Can only close completed, cancelled, or expired escrows
        require!(
            escrow.status == EscrowStatus::Completed
                || escrow.status == EscrowStatus::Cancelled
                || escrow.status == EscrowStatus::Expired,
            EscrowError::InvalidStatus
        );

        // Rent will be returned to renter automatically by Anchor

        emit!(EscrowClosed {
            escrow: escrow.key(),
        });

        Ok(())
    }
}

// ============ ACCOUNTS ============

#[derive(Accounts)]
#[instruction(robot_id: String)]
pub struct CreateRental<'info> {
    #[account(mut)]
    pub renter: Signer<'info>,

    /// CHECK: Operator wallet address (receives funds on completion)
    pub operator: UncheckedAccount<'info>,

    #[account(
        init,
        payer = renter,
        space = Escrow::SPACE,
        seeds = [
            b"escrow",
            renter.key().as_ref(),
            operator.key().as_ref(),
            robot_id.as_bytes()
        ],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CompleteRental<'info> {
    #[account(mut)]
    pub renter: Signer<'info>,

    /// CHECK: Operator receives the funds
    #[account(mut)]
    pub operator: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.renter.as_ref(),
            escrow.operator.as_ref(),
            escrow.robot_id.as_bytes()
        ],
        bump = escrow.bump,
        constraint = escrow.operator == operator.key() @ EscrowError::InvalidOperator
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: Optional platform fee recipient
    #[account(mut)]
    pub platform: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct CancelRental<'info> {
    pub signer: Signer<'info>,

    /// CHECK: Renter receives refund
    #[account(mut)]
    pub renter: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.renter.as_ref(),
            escrow.operator.as_ref(),
            escrow.robot_id.as_bytes()
        ],
        bump = escrow.bump,
        constraint = escrow.renter == renter.key() @ EscrowError::InvalidRenter
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ClaimExpired<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.renter.as_ref(),
            escrow.operator.as_ref(),
            escrow.robot_id.as_bytes()
        ],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub renter: Signer<'info>,

    #[account(
        mut,
        close = renter,
        seeds = [
            b"escrow",
            escrow.renter.as_ref(),
            escrow.operator.as_ref(),
            escrow.robot_id.as_bytes()
        ],
        bump = escrow.bump,
        constraint = escrow.renter == renter.key() @ EscrowError::InvalidRenter
    )]
    pub escrow: Account<'info, Escrow>,
}

// ============ STATE ============

#[account]
pub struct Escrow {
    pub renter: Pubkey,        // 32 bytes
    pub operator: Pubkey,      // 32 bytes
    pub robot_id: String,      // 4 + 32 bytes (max, limited by PDA seed)
    pub amount: u64,           // 8 bytes
    pub created_at: i64,       // 8 bytes
    pub expires_at: i64,       // 8 bytes
    pub status: EscrowStatus,  // 1 byte
    pub bump: u8,              // 1 byte
}

impl Escrow {
    pub const SPACE: usize = 8 + // discriminator
        32 +  // renter
        32 +  // operator
        4 + 32 + // robot_id (String, max 32 bytes for PDA seed)
        8 +   // amount
        8 +   // created_at
        8 +   // expires_at
        1 +   // status
        1 +   // bump
        32;   // padding for safety
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Active,
    Completed,
    Cancelled,
    Expired,
}

// ============ EVENTS ============

#[event]
pub struct RentalCreated {
    pub escrow: Pubkey,
    pub renter: Pubkey,
    pub operator: Pubkey,
    pub robot_id: String,
    pub amount: u64,
    pub expires_at: i64,
}

#[event]
pub struct RentalCompleted {
    pub escrow: Pubkey,
    pub renter: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RentalCancelled {
    pub escrow: Pubkey,
    pub renter: Pubkey,
    pub refund_amount: u64,
}

#[event]
pub struct RentalExpired {
    pub escrow: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowClosed {
    pub escrow: Pubkey,
}

// ============ ERRORS ============

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid rental duration")]
    InvalidDuration,
    #[msg("Invalid robot ID")]
    InvalidRobotId,
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid operator")]
    InvalidOperator,
    #[msg("Invalid renter")]
    InvalidRenter,
    #[msg("Escrow has not expired yet")]
    NotExpired,
}
