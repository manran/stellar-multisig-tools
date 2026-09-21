# PostgreSQL Testnet 切换 Runbook

**范围：仅 Stellar Testnet。Mainnet 继续冻结。**

## 前提

- 代码至少包含 `b35117d` 及后续 PostgreSQL/backfill checkpoint。
- Testnet Vercel 项目连接独立 PostgreSQL 资源并提供 `DATABASE_URL`；migration 环境同时提供 `DATABASE_URL_UNPOOLED` 时优先使用 unpooled URL。
- 操作环境同时具备 Testnet Blob 访问权限与数据库 URL；凭据不得写入仓库。Runtime 使用 pooled `DATABASE_URL`，migration 使用 `DATABASE_URL_UNPOOLED`，避免 transaction pooler 破坏 advisory-lock 会话语义。
- `MULTISIG_COORDINATION_STORAGE` 仍保持 `blob`。

## 1. 初始化数据库

在受控环境执行：

```bash
npm run db:migrate
```

要求：

- `mst_stellar.schema_migrations` 包含全部 migration；
- migration 二次执行返回 no-op；
- 不修改 Blob。

## 2. 在线预回填

保持 Testnet 正常写入，先做一次可重复预回填：

```bash
MST_COORDINATION_BACKFILL_NETWORK=testnet \
MST_COORDINATION_BACKFILL_WRITE=1 \
npm run db:backfill
```

要求：

- source/target digest 完全一致；
- 输出资源/fact counts；
- Integration outbox 行数前后不变；
- 不切换 persistence。

预回填只缩短最终停写窗口，不构成切换依据。

## 3. Final delta freeze

在 Testnet deployment 设置：

```text
MULTISIG_COORDINATION_WRITE_FREEZE=1
```

重新部署/生效后验证：

- Request/Intent `POST/PATCH/PUT` 返回 `503 coordination_write_frozen`；
- GET、Inbox、Activity 仍可读；
- Mainnet 不做任何变更。

## 4. 最终回填与对账

冻结写入后再次执行：

```bash
MST_COORDINATION_BACKFILL_NETWORK=testnet \
MST_COORDINATION_BACKFILL_WRITE=1 \
npm run db:backfill
```

必须同时满足：

- sourceDigest == targetDigest；
- 各类 resource/fact counts 符合预期；
- outbox 无历史 backlog；
- 重跑一次仍得到相同 digest，且无重复事实。

任一项失败：保持 `blob`，解除 freeze，排查后重做；不得切换。

## 5. 切换 Testnet

只有最终对账通过后，将 Testnet deployment 设置为：

```text
MULTISIG_COORDINATION_STORAGE=postgres
MULTISIG_COORDINATION_WRITE_FREEZE=0
```

旧 Blob Request/Intent coordination objects 立即降为只读回滚证据；不得继续 dual-write。

## 6. 切换后验证

依次验证：

1. Human Inbox / Activity；
2. Classic Request 创建、签名、提交；
3. Soroban Intent 创建、AUTH、prepare、reconcile；
4. Intent cancel；
5. Agent Task；
6. Integration Job；
7. Integration Service Activity 分页；
8. FedNetwork E2E；
9. PG outbox 只出现切换后的新 coordination changes。

### 6.1 切换后的回滚窗口

`MULTISIG_COORDINATION_STORAGE=blob` 只允许作为**刚切换后的短窗口回滚手段**：前提是从 final freeze 以来尚未接受任何仅写入 PostgreSQL 的新 coordination fact，且 operator 能再次证明 Blob/PG digest 与事实计数仍一致。

一旦 PostgreSQL 已接受新的 Request / Intent / AUTH / signature / cancellation / execution / outbox 等事实，Blob 就只是切换时的历史证据，不再是可直接恢复的 authority。此后：

- **禁止**仅把 `MULTISIG_COORDINATION_STORAGE` 改回 `blob`；这样会把 runtime 指向陈旧状态。
- 应优先回滚**应用部署版本**，继续连接当前 PostgreSQL authority。
- 若 PostgreSQL 本身损坏，应进入受控的数据库恢复流程（provider backup / point-in-time restore / verified snapshot），恢复后再做 migration/version、关键事实计数和读写 smoke。
- 数据库恢复期间如需要停写，使用 `MULTISIG_COORDINATION_WRITE_FREEZE=1`；不要启用 Blob/PG dual-write 来“补差”。
- 任何恢复都必须保持 Testnet/Mainnet 数据源隔离，且不得从 Testnet 数据构造 Mainnet authority。

因此，长期稳定运行后的标准 rollback 顺序是：

```text
freeze writes if data integrity is in doubt
-> restore/redeploy application against PostgreSQL
-> if needed restore PostgreSQL from verified provider recovery point
-> verify migrations + canonical facts + Inbox/Activity + Request/Intent reads
-> re-enable writes
```

不是：

```text
postgres -> blob
```

## 7. Mainnet

Testnet 连续验证稳定之前，不创建 Mainnet backfill、不设置 Mainnet `DATABASE_URL`、不切换 Mainnet persistence。

Mainnet backfill 命令还需要额外显式：

```text
MST_ALLOW_MAINNET_COORDINATION_BACKFILL=1
```

这只是技术保险，不代表 Mainnet 已获迁移批准。
