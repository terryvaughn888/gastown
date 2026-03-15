# Gas Town as a Service (GTaaS) — Infrastructure Design

> **Date:** 2026-03-15
> **Author:** nux (polecat)
> **Status:** Design Proposal
> **Related:** architecture.md, federation.md, sandboxed-polecat-execution.md, dolt-storage.md, factory-worker-api.md

---

## 1. Problem Statement

Gas Town currently runs as a single-tenant, single-machine system. A developer
installs the `gt` binary, runs `gt install`, and gets a town on their laptop.
Every component — the Dolt server, daemon, tmux sessions, polecats, witnesses,
refineries — shares one UID, one filesystem, and one set of credentials.

This works for individual developers. It does not work for:

- **Teams** who want a shared Gas Town instance with coordinated work queues
- **Organizations** that need isolation between projects or departments
- **Platform offerings** where Gas Town powers a hosted development service
- **Scaling beyond one machine** when polecat demand exceeds local resources

GTaaS productizes Gas Town into a multi-tenant service that retains the
single-machine developer experience while enabling shared, scalable, and
isolated deployments.

---

## 2. Design Principles

1. **Preserve the local model.** A single-developer laptop installation must
   remain the default and feel unchanged. GTaaS is an additive layer.

2. **Isolation by default.** Tenants cannot observe, interfere with, or access
   each other's data, agents, or resources. Failures are contained.

3. **Dolt is the data plane.** Do not introduce a second database. All
   multi-tenancy concerns (routing, isolation, federation) build on Dolt.

4. **ZFC holds.** Go code transports; agents decide. Multi-tenancy is a
   transport concern, not an intelligence concern. No agent reasoning changes.

5. **Control plane / work plane separation.** Per the sandboxed execution
   design, agent work (LLM inference, file edits, git) is separable from
   control operations (beads, mail, lifecycle). GTaaS enforces this separation
   at infrastructure boundaries.

---

## 3. Multi-Tenancy Model

### 3.1 Tenant Definition

A **tenant** is one Gas Town installation — conceptually equivalent to a "town."
Each tenant has:

| Property | Description |
|----------|-------------|
| `tenant_id` | Globally unique identifier (UUID) |
| `owner` | Entity (person or org) that owns the tenant |
| `display_name` | Human-readable name (e.g., "Acme Corp Dev") |
| `tier` | Service tier: `free`, `standard`, `enterprise` |
| `created_at` | Creation timestamp |
| `config` | Tenant-level settings (max polecats, max rigs, etc.) |

A tenant maps 1:1 to a town root directory tree on the infrastructure.

### 3.2 Tenant Hierarchy

```
GTaaS Platform
├── Tenant: acme-corp (town: /tenants/acme-corp/gt/)
│   ├── Rig: backend    (repo: github.com/acme/backend)
│   │   ├── Polecats: [alpha, bravo, charlie]
│   │   ├── Witness
│   │   └── Refinery
│   ├── Rig: frontend   (repo: github.com/acme/frontend)
│   │   ├── Polecats: [delta]
│   │   ├── Witness
│   │   └── Refinery
│   └── Mayor, Deacon, Daemon
│
├── Tenant: solo-dev (town: /tenants/solo-dev/gt/)
│   └── Rig: my-project
│       └── ...
```

Each tenant is a complete, independent Gas Town installation. No shared state
between tenants except at the platform orchestration layer.

### 3.3 Intra-Tenant Isolation

Within a tenant, the existing Gas Town isolation model applies:

- **Rig isolation**: Separate git repositories, separate beads databases
- **Polecat isolation**: Separate git worktrees, separate tmux sessions
- **Data isolation**: Rig-level beads are per-rig; town-level beads coordinate

No changes to this model for GTaaS. It already works.

---

## 4. Deployment Architecture

### 4.1 Topology

```
                    ┌──────────────────────────┐
                    │   GTaaS Control Plane     │
                    │                           │
                    │  ┌─────────┐  ┌────────┐ │
                    │  │Tenant   │  │Billing │ │
                    │  │Registry │  │Metering│ │
                    │  └────┬────┘  └───┬────┘ │
                    │       │           │      │
                    │  ┌────┴───────────┴───┐  │
                    │  │  Orchestrator      │  │
                    │  │  (tenant lifecycle)│  │
                    │  └────────┬───────────┘  │
                    └───────────┼───────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐
     │  Compute Node  │  │ Compute Node  │  │ Compute Node  │
     │                │  │               │  │               │
     │ ┌────────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │
     │ │ Tenant A   │ │  │ │ Tenant B  │ │  │ │ Tenant C  │ │
     │ │ (town)     │ │  │ │ (town)    │ │  │ │ (town)    │ │
     │ │            │ │  │ │           │ │  │ │           │ │
     │ │ Dolt (:N)  │ │  │ │ Dolt (:N) │ │  │ │ Dolt (:N) │ │
     │ │ Daemon     │ │  │ │ Daemon    │ │  │ │ Daemon    │ │
     │ │ tmux       │ │  │ │ tmux      │ │  │ │ tmux      │ │
     │ └────────────┘ │  │ └───────────┘ │  │ └───────────┘ │
     └────────────────┘  └───────────────┘  └───────────────┘
```

### 4.2 Compute Node

Each compute node is a VM or container host running one or more tenant towns.
A node provides:

- **Linux host** with tmux, git, Go runtime
- **Filesystem namespace** per tenant (separate home dirs)
- **Network namespace** per tenant (isolated Dolt ports, no cross-tenant access)
- **Resource limits** (CPU, memory, disk) enforced via cgroups

### 4.3 Tenant Placement

The orchestrator assigns tenants to nodes using bin-packing:

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Active polecats | High | Primary resource consumer (LLM API calls + CPU) |
| Dolt database size | Medium | Disk and memory footprint |
| Rig count | Low | Mostly metadata overhead |
| Tier | Modifier | Enterprise tenants get dedicated nodes |

**Placement strategies:**

- `shared` (free/standard): Multiple tenants per node, resource limits enforced
- `dedicated` (enterprise): One tenant per node, full resource access
- `burst` (any tier): Overflow to ephemeral nodes during peak demand

### 4.4 Component Mapping

| Gas Town Component | GTaaS Deployment | Notes |
|-------------------|-----------------|-------|
| `gt` binary | Pre-installed on compute nodes | Same binary, tenant config injected |
| Daemon | One per tenant, managed by systemd | Orchestrator starts/stops |
| Dolt server | One per tenant, unique port | Port allocated by orchestrator |
| tmux server | One per tenant, unique socket | Socket path includes tenant_id |
| Mayor/Deacon | Per-tenant AI agents | Standard Gas Town lifecycle |
| Polecats | Per-tenant workers | Sandboxed execution (see section 5) |
| Witness/Refinery | Per-rig, per-tenant | Standard Gas Town lifecycle |

---

## 5. Isolation Architecture

### 5.1 Isolation Layers

```
Layer 0: Network         — Network namespaces, no cross-tenant connectivity
Layer 1: Filesystem      — Per-tenant root (/tenants/<id>/), no shared paths
Layer 2: Process          — Per-tenant UID, cgroup resource limits
Layer 3: Dolt            — Per-tenant Dolt server, unique port
Layer 4: tmux            — Per-tenant socket (already uses per-town sockets)
Layer 5: Git             — Per-tenant git credentials, separate worktrees
Layer 6: Secrets          — Per-tenant credential vault, no shared keys
```

### 5.2 Per-Tenant Dolt Isolation

Today, Gas Town runs one Dolt server on port 3307. For GTaaS:

**Option A: Port-per-tenant** (recommended for initial deployment)

```
Tenant A → Dolt on :13307
Tenant B → Dolt on :13308
Tenant C → Dolt on :13309
```

- Orchestrator allocates ports from a range (13300–14300)
- Port injected via `GT_DOLT_PORT` environment variable
- Each Dolt server has its own `~/.dolt-data/` directory
- Existing `gt dolt start/stop` commands work unchanged
- Resource limits via cgroups prevent one tenant's Dolt from starving others

**Option B: Shared Dolt with database-level isolation** (future optimization)

- Single Dolt server per node, tenant databases prefixed: `acme_hq`, `acme_gastown`
- MySQL user per tenant with `GRANT` restrictions
- Pro: Lower memory overhead (one server process)
- Con: Blast radius — one tenant's query can degrade others; Dolt lacks
  per-database resource limits today

Start with Option A. Migrate to Option B only if memory pressure forces it,
and only after Dolt adds per-database resource controls.

### 5.3 Per-Tenant Filesystem Layout

```
/tenants/
├── acme-corp/
│   ├── home/                    # HOME for this tenant's agents
│   │   ├── .claude/             # Claude Code config
│   │   ├── .dolt-data/          # Dolt data directory
│   │   └── .ssh/                # Git credentials (injected)
│   └── gt/                      # Town root
│       ├── mayor/
│       ├── settings/
│       ├── daemon/
│       ├── .beads/
│       └── <rigs>/
│
├── solo-dev/
│   ├── home/
│   └── gt/
```

Each tenant gets a dedicated `HOME` directory. The `gt` binary reads `$HOME`
to locate `.dolt-data/`, `.claude/`, and credentials. No code changes needed —
just set `HOME=/tenants/<id>/home` in the tenant's environment.

### 5.4 Polecat Sandboxing

GTaaS builds on the sandboxed execution design (`sandboxed-polecat-execution.md`):

| Execution Backend | GTaaS Use | Description |
|-------------------|-----------|-------------|
| `local` | Dev/free tier | tmux sessions on the compute node, cgroup-limited |
| `exitbox` | Standard tier | Lightweight container per polecat, shared node |
| `daytona` | Enterprise/burst | Remote container on Daytona, full isolation |

The control plane (beads, mail, lifecycle events) always runs on the compute
node. Only the work plane (LLM inference, file edits) is sandboxed. This
matches the existing architecture separation.

---

## 6. API Boundaries

### 6.1 Platform API (new — GTaaS orchestration)

The Platform API manages tenants and is consumed by the GTaaS web console,
CLI, and billing system. It does not replace any existing Gas Town commands.

```
POST   /v1/tenants                    Create tenant
GET    /v1/tenants/:id                Get tenant details
PATCH  /v1/tenants/:id                Update tenant config
DELETE /v1/tenants/:id                Deprovision tenant

POST   /v1/tenants/:id/rigs           Add rig (connect repo)
DELETE /v1/tenants/:id/rigs/:rig      Remove rig

GET    /v1/tenants/:id/status         Tenant health and agent status
GET    /v1/tenants/:id/usage          Resource consumption metrics
GET    /v1/tenants/:id/agents         List active agents

POST   /v1/tenants/:id/actions/start  Start tenant (daemon + Dolt)
POST   /v1/tenants/:id/actions/stop   Stop tenant gracefully
POST   /v1/tenants/:id/actions/cycle  Cycle specific agent
```

**Authentication:** API keys scoped to tenant, with platform admin keys for
cross-tenant operations.

### 6.2 Tenant-Internal APIs (existing, unchanged)

Within a tenant, the existing Gas Town command surface applies:

- `gt prime`, `gt done`, `gt hook` — Agent lifecycle
- `gt mail`, `gt nudge` — Inter-agent communication
- `bd show`, `bd create`, `bd close` — Beads operations
- `gt dolt status` — Dolt health

No changes to these commands. The tenant boundary is transparent to agents —
a polecat inside GTaaS runs the same commands as a polecat on a laptop.

### 6.3 Factory Worker API (planned, per factory-worker-api.md)

The Factory Worker API replaces tmux-based agent interaction with structured
HTTP endpoints. GTaaS accelerates the need for this API:

- **Lifecycle events** enable the orchestrator to monitor agent health
- **Prompt submission** replaces tmux send-keys with reliable delivery
- **Tool authorization** enables per-tenant permission policies

GTaaS should adopt the Factory Worker API as its primary agent interaction
mechanism, falling back to tmux for local-only deployments.

---

## 7. Billing and Metering

### 7.1 Metering Points

| Metric | Source | Granularity |
|--------|--------|-------------|
| **LLM tokens** | Claude Code JSONL telemetry | Per-agent, per-session |
| **Active polecat-hours** | Daemon heartbeat events | Per-polecat, per-minute |
| **Dolt storage** | `du -s ~/.dolt-data/` | Per-tenant, hourly |
| **Git storage** | `du -s /tenants/<id>/gt/` | Per-tenant, hourly |
| **Merge queue runs** | Refinery gate execution logs | Per-MR |
| **Compute time** | cgroup accounting | Per-tenant, per-minute |

### 7.2 Metering Architecture

```
Agent sessions ──► JSONL telemetry files
                        │
Daemon heartbeat ──►    │
                        ▼
                ┌──────────────┐
                │ Metrics      │
                │ Collector    │   (per-node sidecar)
                │              │
                │ Reads:       │
                │ - JSONL logs │
                │ - cgroup stats│
                │ - Dolt status│
                └──────┬───────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Metering Service │   (platform-level)
              │                  │
              │ Aggregates per   │
              │ tenant, emits    │
              │ usage events     │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Billing System   │
              │ (Stripe / etc)   │
              └──────────────────┘
```

### 7.3 Cost Model

The primary cost drivers for GTaaS are LLM API calls (token consumption) and
compute time. Storage is secondary.

| Tier | Max Polecats | Max Rigs | Dolt Storage | LLM Tokens | Compute |
|------|-------------|----------|-------------|------------|---------|
| Free | 1 | 1 | 500 MB | Included (capped) | Shared |
| Standard | 5 | 5 | 10 GB | Pass-through + margin | Shared |
| Enterprise | 20+ | Unlimited | 100 GB+ | Volume discount | Dedicated |

**LLM cost pass-through:** GTaaS does not run inference — it orchestrates
agents that call Claude via the customer's own API key or a platform-provided
key. For platform-provided keys, usage is metered and billed at a margin.

---

## 8. Onboarding Flow

### 8.1 Tenant Provisioning

```
Step 1: Sign Up
  └── Create account, select tier
       └── POST /v1/tenants {owner, display_name, tier}

Step 2: Provision
  └── Orchestrator allocates:
       ├── Compute node assignment (bin-pack or dedicated)
       ├── Filesystem namespace (/tenants/<id>/)
       ├── Dolt port allocation
       ├── UID allocation
       └── Credential vault initialization

Step 3: Initialize Town
  └── On the compute node:
       ├── gt install (creates town structure)
       ├── gt dolt start (starts Dolt server)
       ├── gt daemon start (starts daemon)
       └── Inject platform agent config (metering hooks, API keys)

Step 4: Connect First Rig
  └── User provides repo URL + credentials
       ├── gt rig add <name> --repo=<url>
       ├── Clone canonical repo into mayor/rig/
       ├── Initialize rig beads database
       └── Spawn Witness + Refinery

Step 5: First Work
  └── User creates or imports issues
       ├── bd create --title="First task" --type=task
       ├── gt sling <issue> (dispatches to polecat)
       └── Polecat spawns and begins work
```

### 8.2 Rig Onboarding

Adding a new rig to an existing tenant:

1. **Connect repository:** Provide git URL and access credentials
2. **Configure gates:** Set build, test, lint, typecheck commands
3. **Set capacity:** Max polecats for this rig
4. **Initialize:** `gt rig add` creates the rig structure, spawns Witness/Refinery
5. **Import work:** Optionally sync issues from GitHub/Linear/Jira

### 8.3 Migration from Local

For users migrating from a laptop Gas Town to GTaaS:

1. **Export:** `gt export --format=archive` packages town state (beads, config,
   rig list) into a portable archive. Git repos are referenced by URL, not copied.
2. **Import:** `gt import --archive=<file>` on the GTaaS tenant restores config,
   re-clones repos, and replays beads history into the new Dolt instance.
3. **Verify:** `gt doctor` runs health checks on the imported town.

---

## 9. Scaling Strategy

### 9.1 Scaling Dimensions

| Dimension | Current (single machine) | GTaaS Target |
|-----------|------------------------|--------------|
| Polecats per tenant | ~5 (laptop limit) | 20+ (enterprise) |
| Tenants per node | 1 | 5-20 (shared tier) |
| Nodes | 1 | Auto-scaling pool |
| Rigs per tenant | ~3 | Unlimited (enterprise) |
| Dolt DB size | ~1 GB | 100 GB+ with compaction |

### 9.2 Horizontal Scaling

**Tenant-level scaling:** Each tenant is a self-contained unit. Scaling tenants
means adding compute nodes. No shared state between tenants simplifies this.

**Intra-tenant scaling:** Within a tenant, scaling means more polecats. This is
already handled by the scheduler (`internal/scheduler/`), which enforces
`max_polecats` per rig. GTaaS raises the ceiling by providing more compute.

**Node auto-scaling:**

```
Orchestrator monitors:
  - Node CPU/memory utilization
  - Queued tenant provisioning requests
  - Active polecat count across nodes

Scaling rules:
  - Scale up: Any node > 80% CPU for > 5 minutes
  - Scale up: Provisioning queue depth > 0 for > 2 minutes
  - Scale down: Node < 20% CPU for > 30 minutes AND tenant can be migrated
```

### 9.3 Tenant Migration

When rebalancing nodes, a tenant can be live-migrated:

1. **Quiesce:** Stop daemon, wait for active polecats to finish current task
2. **Snapshot:** rsync tenant filesystem to destination node
3. **Dolt sync:** Dolt push to backup remote, pull on destination
4. **Switch:** Update orchestrator routing, start daemon on destination
5. **Verify:** `gt doctor` on destination

Estimated migration time for a typical tenant: 2-5 minutes (dominated by
filesystem sync). Tenants with large git repos take longer.

### 9.4 Data Lifecycle at Scale

The existing three-tier data lifecycle (operational → ledger → design) maps
cleanly to GTaaS:

| Tier | Storage | GTaaS Implications |
|------|---------|-------------------|
| Operational (Dolt) | Per-tenant Dolt server | Bounded by wisp reaping + compaction |
| Ledger (JSONL → git) | Git repo, pushed to remote | Standard git hosting, unlimited history |
| Design (Dolt + federation) | DoltHub or self-hosted remote | Cross-tenant federation via HOP URIs |

The wisp reaper and compactor dogs are critical for GTaaS — without them, Dolt
databases grow unbounded. GTaaS should enforce reaper runs and alert on database
size thresholds.

---

## 10. Security Considerations

### 10.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Tenant A accesses Tenant B's data | Filesystem + network namespace isolation |
| Polecat escapes sandbox | exitbox/daytona container boundaries |
| Credential leakage | Per-tenant vault, credentials injected at runtime, never on disk |
| Malicious MCP server | Per-tenant MCP allowlists, network egress filtering |
| Dolt injection | Parameterized queries throughout (`beads.go` already does this) |
| Git credential theft | Short-lived tokens, rotated per-session |
| Denial of service | cgroup resource limits, per-tenant rate limiting |

### 10.2 Credential Management

Tenants need credentials for:

- **Git access** (GitHub/GitLab tokens for repo operations)
- **LLM API keys** (Claude API keys for agent inference)
- **Platform API keys** (GTaaS platform authentication)

All credentials are stored in a per-tenant vault (e.g., HashiCorp Vault or
AWS Secrets Manager). Credentials are injected into the tenant's environment
at daemon startup and rotated on a schedule. They are never written to the
tenant's filesystem in plaintext.

### 10.3 Audit Trail

Every tenant action is logged:

- **Beads operations:** Dolt commit history provides full audit trail
- **Agent actions:** Claude Code JSONL telemetry captures all tool calls
- **Platform operations:** API calls logged with tenant_id, timestamp, action
- **Git operations:** Standard git log per repository

Enterprise tenants can export audit logs to their SIEM.

---

## 11. Operational Concerns

### 11.1 Monitoring

| Component | Health Check | Alert Threshold |
|-----------|-------------|-----------------|
| Dolt server | `gt dolt status` via orchestrator | Latency > 5s or unreachable |
| Daemon | systemd watchdog + process check | Not running for > 1 minute |
| Polecats | Witness patrol (existing) | Zombie state > 10 minutes |
| Compute node | CPU, memory, disk utilization | > 85% sustained |
| Metering | Event pipeline lag | > 5 minutes behind |

### 11.2 Backup and Recovery

- **Dolt:** Periodic `dolt push` to backup remote (already implemented via backup dog)
- **Filesystem:** Daily snapshots of `/tenants/` via cloud provider (EBS snapshots, etc.)
- **Recovery:** Restore from Dolt remote + filesystem snapshot. RPO: 1 hour. RTO: 15 minutes.

### 11.3 Upgrades

GTaaS nodes run a single `gt` binary version. Upgrades are rolling:

1. Build new binary, publish to artifact store
2. For each node (one at a time):
   a. Drain: Stop accepting new tenant provisioning
   b. Quiesce: Wait for active polecats to complete (with timeout)
   c. Upgrade: Replace binary, restart daemons
   d. Verify: `gt doctor` on each tenant
   e. Resume: Accept new work

Dolt schema migrations run automatically on first `bd` command after upgrade
(existing behavior). No manual migration step needed.

---

## 12. Implementation Phases

### Phase 1: Single-Node Multi-Tenant (MVP)

- Per-tenant filesystem isolation on one node
- Port-per-tenant Dolt isolation
- Platform API for tenant CRUD
- Basic metering (polecat-hours, storage)
- Manual tenant provisioning via CLI

**Builds on:** Existing `gt install`, daemon, Dolt server management

### Phase 2: Orchestration and Scaling

- Multi-node deployment with orchestrator
- Tenant placement and bin-packing
- Auto-scaling node pool
- Tenant live migration
- Web console for tenant management

**Builds on:** Phase 1 + container/VM infrastructure

### Phase 3: Sandboxed Execution

- exitbox backend for polecat isolation
- daytona backend for burst scaling
- Factory Worker API adoption
- Per-tenant network egress policies

**Builds on:** Phase 2 + sandboxed-polecat-execution.md + factory-worker-api.md

### Phase 4: Billing and Federation

- Stripe integration for metered billing
- Self-service onboarding flow
- Cross-tenant federation via HOP URIs
- Enterprise audit log export
- SLA enforcement

**Builds on:** Phase 3 + federation.md

---

## 13. Open Questions

1. **LLM key model:** Should GTaaS provide Claude API keys (platform-managed)
   or require tenants to bring their own? Platform-managed simplifies onboarding
   but adds billing complexity and cost risk.

2. **Dolt version coupling:** If GTaaS runs a specific Dolt version, how do we
   handle tenants that need different versions? Pin per-node or per-tenant?

3. **Git hosting:** Should GTaaS include managed git hosting, or always connect
   to external GitHub/GitLab? Managed hosting simplifies onboarding but adds
   operational scope.

4. **Tenant self-service:** How much configuration should tenants control
   directly (max polecats, agent models, gate commands) vs. requiring platform
   admin intervention?

5. **Multi-region:** Should tenants be pinned to a region, or can they span
   regions? Data residency requirements may force regional pinning.
