# Multisig wallets (mainnet, 2-of-3)

Public information only. No private keys.

## Signers
- EVM (Ethereum / BSC): `0x3732f7ea0ac0f2B7BDe8e46c7D82350090F6BbDe`, `0xC4058934DAC920113Bd3276B212030262D497D3B`, ours `0x2361e4B9458c2b2Bc99fb3072B023662bfa57E20`
- Solana: `2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc`, `Dg2NQ8wNfk7hZva7Gi7hCQNwWMBjZKqEuWGa1jZ2TQoq`, ours `GeLDQbmsVAL1C8K9mR5GrfqYYaqZNQ8yk8hY2YwiD2Us`

## Deployments
| Chain | Address | Deploy tx | Result |
|---|---|---|---|
| Ethereum | `0xbfa2C12D28838bEA6C92645c195fAa907182ECed` (Safe 1.4.1) | `0x8bc3dff1be6a48cad8ac3b8f213d5fb56e98ffdb16eac6d37fac80268af10c27` | getOwners = the 3 EVM signers, getThreshold = 2 |
| BSC | `0xbfa2C12D28838bEA6C92645c195fAa907182ECed` (Safe 1.4.1) | `0x280f3ec46210e3e004ae05b2c4f99503364eb40eafce93bb62b5234995122fee` | getOwners = the 3 EVM signers, getThreshold = 2 |
| Solana | Squads v4 multisig `BcrXD8XaAXu8qUYJajbSjPnPJ1TN3ofrqGYNqgGgeSVH`, vault 0 `FPKFevoHzjPZWjWaRxwFwfNXu2LBduoGspXZSCLU81yz` | create: `2YyGoXDkGnwnt1h4YARixR1zptovvfwtPwQaa3FZ6xcfTj9P57MF6ivbD97NgAHJP5v44yJVr8TLdUrWVnZhTNUe` | members = the 3 Solana signers (all permissions), threshold 2, timeLock 0, configAuthority = none (autonomous; config changes need 2 votes) |

EVM Safes: official SafeProxyFactory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`, fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`. Same address on both chains (same salt).

## Daily limits (our address only; none for user addresses)
Status: **proposed, not yet active.** Needs one more signature/vote from a user address.

### Ethereum / BSC (Safe AllowanceModule `0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134`)
One Safe tx per chain (nonce 0, delegatecall to MultiSendCallOnly `0x9641d764fc13c8B624c04430C7356C1C7C8102e2`) doing: enableModule(AllowanceModule), addDelegate(our address), setAllowance(our address, token, 100, resetTimeMin 1440, resetBaseMin 0).
- Ethereum: USDC `0xA0b8...eB48` 100 (6 dec). safeTxHash `0x088506467a3678ed7d84374ea863274e58da8695fe01f52090879d063d16015b`
- BSC: USDT `0x55d3...7955` 100 and USDC `0x8AC7...580d` 100 (18 dec). safeTxHash `0x2ddf47b2ae3da305bb30440fc5d027f37345c719e352da208a112d53e1970794`
- Full tx data and our signature: `docs/multisig-proposals.json`.

**User to do (each chain):** open the Safe in app.safe.global (or use the JSON with protocol-kit), recreate/import this exact tx (same to/data/operation/nonce 0, safeTxHash must match), add our signature from the JSON, sign with one user address, and execute. Then verify with `isModuleEnabled` and `getTokenAllowance`.

### Solana (Squads spending limit)
Config transaction index 1 (AddSpendingLimit: vault 0, mint USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 100 USDC, period Day, member = our address only, any destination). Proposal `n5Kua5TSiGCV1Dox9HAF4hnpWeeBiWqJiFQNLCwaq4` is Active with 1/2 approvals (ours). Config tx create: `5Kh6Lcjg9kmnjbemYH8Z5c4cuf2QKXfaegpC2GLB64zAHkVM6qx8fXKV1cMJn3YUBW9LjYwRMQcDst1mCyH7Spja`; proposal create: `36y5tgFJVVtakDJjFUGU6UTqFSjbhzHKAiuPz8MTM1X6ULyJnWB3VokKmvpoAyEM4kWKvcPYGcefMJpPUMiTU24x`; our approval: `3AJGi2kBiakWR71T8M8kma6x2vqi7HuQyKVWGj7sAQhEJ9t8rP8eu1yUuV2dYbtEDKqHi8pAbxsJo8KYPeUjytV9`.

**User to do:** open app.squads.so, connect a user wallet, approve the pending proposal (transaction #1) and execute it.

## Update 2026-10-15: new BSC Safe (SafeL2)
- Address: `0x71c04f3C4922d1A6FA2724428d4E2c51f5445837` (Safe 1.4.1, SafeL2 singleton `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, official SafeProxyFactory and fallback handler above). Deploy tx: `0x3a6f61fc7327decf25530941cc634ac91dfea9308dfc95d1af34855c3ac04549` (block 127811823).
- Verified: owners = the 3 EVM signers, threshold 2, singleton and fallback handler as above.
- Daily-limit proposal (nonce 0; enableModule AllowanceModule, addDelegate our address, USDT 100 and USDC 100 per day, 18 decimals) safeTxHash `0xbf87817eaacf7b597527a14bd5d70cb34ff23b156d4590bfc67c8b11d9843209`. Submitted to the Safe Transaction Service with our signature (1/2), pending. Data: `docs/multisig-proposals-bsc-l2.json`.
- User to do: in app.safe.global (BSC, `bnb:0x71c0...5837`) sign the pending tx with one user address and execute.
- The old BSC Safe `0xbfa2...ECed` (non-L2) is unused and holds no funds; its pending proposal can be ignored.

## Update 2026-10-20: Base and Arbitrum One Safes (SafeL2 1.4.1)
Same factory, singleton (SafeL2 `0x29fc...C762`), fallback handler, owners, threshold 2 and salt as the BSC SafeL2, so the address is the same on BSC, Base and Arbitrum: `0x71c04f3C4922d1A6FA2724428d4E2c51f5445837`.

| Chain | Deploy tx | Gas used / fee |
|---|---|---|
| Arbitrum One | `0xdd5b9e504b673f2caa35f365992f01a2f06fbc44ca41e97b2b28ab05d3a51d4d` (block 516480650) | 306,836 / ~0.0000061 ETH |
| Base | `0xde25cfa7146b9cb7343c2a44ef9154ee5b09b1e4c9d4fbb84c93449678401a53` (block 52838932) | 305,895 / ~0.0000018 ETH |

Verified on both: owners = the 3 EVM signers, threshold 2, VERSION 1.4.1, singleton SafeL2, fallback handler `0xfd07...Ec99`, modules = none, guard = none (zero).

Funding: ETH bridged Arbitrum -> Base to the same signer address via Across SpokePool `depositV3` (0.00025 ETH in, 0.000248065 ETH out). Deposit `0x0a44b585935ab5880b4cdacd3ae42c08c1b0aeabb623ceb7419fb1d2d4b88828`, fill on Base `0x5b154ea3c0d47e58d1e6df1b87760f5c82fdcc333d84bf5f70078bccbae796a9`.

Daily-limit proposals (nonce 0; enableModule AllowanceModule `0xCFbF...3134`, addDelegate our address, USDC 100/day for our address only, 6 decimals), submitted to the Safe Transaction Service with our signature (1/2):
- Base (USDC `0x8335...2913`): safeTxHash `0xe923f1bfc3adf6e49218b2e1cebe2831af3f7835da48502e21dc344a2d28692f`
- Arbitrum (USDC `0xaf88...5831`): safeTxHash `0x7e77592af5f8b9d8c94712f9bb6bbb64dbefce1232e824d0f3cd22e847896d2a`
- Data: `docs/multisig-proposals-base-arb.json`.
- User to do: in app.safe.global (`base:0x71c0...5837` and `arb1:0x71c0...5837`), sign the queued nonce-0 tx with `0x3732f7ea...BbDe` or `0xC4058934...7D3B` and execute.

`receive-config.js` CONFIG_MAINNET: base and arb now point to this Safe; the old address `0x257ae349...6458` is in legacy.

Solana check (read-only, 2026-10-20): multisig `BcrXD8Xa...eSVH` exists, owned by the Squads v4 program, threshold 2, timeLock 0, autonomous, 3 members as above. Vault 0 derives to `FPKFevoH...81yz`. Spending-limit proposal #1 is Executed.
