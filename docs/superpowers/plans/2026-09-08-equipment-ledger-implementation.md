# Equipment Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack equipment ledger (Next.js + NestJS + MongoDB) where an asset can never be held by two workers at once, reservations never overlap, corrections never erase history, retries never double-write, and "who held what at any past instant" is answerable by replaying the ledger.

**Architecture:** npm workspaces monorepo (`apps/web` Next.js, `apps/api` NestJS, `packages/shared` TS types/zod DTOs). MongoDB (single-node replica set, via Docker Compose) is the only datastore. Mongoose schema classes are the code-first source of truth for document shape/indexes; `migrate-mongo` versions index/replica-set changes. "One holder, ever" is enforced by a single-document atomic `findOneAndUpdate` compare-and-swap on `Asset.status`; reservation non-overlap is enforced by a Mongo transaction serialized via a per-asset lock-document nonce bump.

**Tech Stack:** TypeScript, Next.js (App Router), NestJS, Mongoose/MongoDB, migrate-mongo, zod, Jest, Tailwind CSS, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-equipment-ledger-design.md`

## Global Constraints

- Node.js + npm workspaces monorepo: `apps/web`, `apps/api`, `packages/shared` — exact paths, no alternate layout.
- API listens on port 4000, web app on port 3000 (spec §2/§7; Next.js default 3000 collides with Nest's own default, so Nest is explicitly configured to 4000).
- MongoDB runs only in Docker Compose, as a single-node replica set (`--replSet rs0`) — required for multi-document transactions (spec §2, §4).
- Every mutating request DTO carries a client-supplied `idempotencyKey: string`, unique-indexed on `movements` and `reservations` (spec §3, §4).
- Asset `_id` is a human-readable string code (e.g. `HARN-014`), not an ObjectId (spec §3).
- Movements are append-only: no document in `movements` is ever mutated after insert except setting `correctedBy` on the original when a correction is filed (spec §3, §5).
- "One holder, ever" is enforced by atomic `findOneAndUpdate` CAS on `Asset.status`, never by a lock or transaction alone (spec §4).
- Reservation overlap is enforced via the `asset_locks` nonce-bump + transaction pattern, never by application-level mutexes or a hand-rolled lock/timeout system (spec §4).
- No authentication, roles/permissions, email, file uploads, barcode scanning, mobile app, or multi-site support (spec §1).
- Git commits in this repo carry **no** Claude/Anthropic co-author trailer (project convention).

---

## Phase 1 — Foundation

### Task 1: Monorepo scaffold, Docker Compose Mongo replica set, dev boot

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`
- Create: `docker-compose.yml`, `scripts/mongo-init.sh`
- Create: `.gitignore` additions (already has Node boilerplate; add `apps/*/dist`, `.next`, `node_modules` if not already covered)
- Test: `scripts/smoke-test.sh` (manual verification script, see Step 5)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: running dev environment — API reachable at `http://localhost:4000`, web app at `http://localhost:3000`, Mongo reachable at `mongodb://localhost:27017/equipment_ledger?replicaSet=rs0` with transactions usable. All later tasks assume `docker compose up -d` has been run and `npm install` + `npm run dev` boots both apps.

- [ ] **Step 1: Write root `package.json` with npm workspaces**

```json
{
  "name": "equipment-ledger",
  "private": true,
  "workspaces": ["apps/api", "apps/web", "packages/shared"],
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"npm run start:dev -w apps/api\" \"npm run dev -w apps/web\"",
    "build": "npm run build -w packages/shared && npm run build -w apps/api && npm run build -w apps/web",
    "test": "npm run test -w apps/api && npm run test -w packages/shared",
    "seed": "npm run seed -w apps/api",
    "check-invariants": "npm run check-invariants -w apps/api"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Scaffold `apps/api` (NestJS)**

`apps/api/package.json`:
```json
{
  "name": "@equipment-ledger/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "test": "jest --runInBand",
    "seed": "ts-node -r tsconfig-paths/register src/scripts/seed.ts",
    "check-invariants": "ts-node -r tsconfig-paths/register src/scripts/check-invariants.ts",
    "migrate": "migrate-mongo up -f migrate-mongo-config.js"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/mongoose": "^10.1.0",
    "@nestjs/platform-express": "^10.4.4",
    "mongoose": "^8.7.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.8",
    "@equipment-ledger/shared": "*"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/testing": "^10.4.4",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.5",
    "jest": "^29.7.0",
    "migrate-mongo": "^11.0.1",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0"
  }
}
```

`apps/api/nest-cli.json`:
```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`apps/api/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 4: Scaffold `apps/web` (Next.js)**

`apps/web/package.json`:
```json
{
  "name": "@equipment-ledger/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "test": "jest"
  },
  "dependencies": {
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@equipment-ledger/shared": "*"
  },
  "devDependencies": {
    "@types/node": "^22.7.5",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "tailwindcss": "^3.4.13",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.5.0"
  }
}
```

`apps/web/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

`apps/web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

`apps/web/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`apps/web/src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/web/src/app/layout.tsx`:
```tsx
import './globals.css';

export const metadata = { title: 'Equipment Ledger' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
export default function HomePage() {
  return <main className="p-8">Equipment Ledger</main>;
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["dom", "dom.iterable", "esnext"],
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Write `docker-compose.yml` and the replica-set init script**

`docker-compose.yml`:
```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 5s
      timeout: 5s
      retries: 10

  mongo-init:
    image: mongo:7
    depends_on:
      mongo:
        condition: service_healthy
    entrypoint: ["bash", "/scripts/mongo-init.sh"]
    volumes:
      - ./scripts/mongo-init.sh:/scripts/mongo-init.sh:ro

volumes:
  mongo_data:
```

`scripts/mongo-init.sh` (idempotent — safe to run every `docker compose up`):
```bash
#!/usr/bin/env bash
set -euo pipefail

STATUS=$(mongosh --host mongo --quiet --eval "try { rs.status().ok } catch (e) { 0 }")

if [ "$STATUS" != "1" ]; then
  echo "Initiating replica set rs0..."
  mongosh --host mongo --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'mongo:27017'}]})"
else
  echo "Replica set rs0 already initiated."
fi
```

- [ ] **Step 6: Boot everything and verify manually**

Run:
```bash
docker compose up -d
docker compose exec mongo mongosh --quiet --eval "rs.status().myState"
```
Expected: prints `1` (PRIMARY) — retry after a few seconds if it prints `0` while the replica set is still electing.

Run:
```bash
npm install
npm run dev
```
Expected: API logs listening on port 4000, web app logs ready on port 3000. Visit `http://localhost:3000` in a browser — page renders "Equipment Ledger". `curl http://localhost:4000` returns Nest's default 404 JSON (no routes registered yet — expected, routes come in later tasks).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json apps/api apps/web docker-compose.yml scripts/mongo-init.sh
git commit -m "chore: scaffold monorepo, Docker Compose Mongo replica set, dev boot"
```

### Task 2: Shared enums, zod DTOs, and inferred types

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/dtos.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/dtos.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task, both apps): `MovementType`, `AssetStatus`, `ReservationStatus` enums; `IssueMovementSchema`/`IssueMovementDto`, `ReturnMovementSchema`/`ReturnMovementDto`, `CorrectMovementSchema`/`CorrectMovementDto`, `CreateReservationSchema`/`CreateReservationDto`, all exported from `@equipment-ledger/shared`.

- [ ] **Step 1: Write `packages/shared/package.json` and `tsconfig.json`**

```json
{
  "name": "@equipment-ledger/shared",
  "version": "0.0.1",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "jest": "^29.7.0", "ts-jest": "^29.2.5", "@types/jest": "^29.5.13" }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "declaration": true, "rootDir": "./src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test for the DTO schemas**

`packages/shared/src/dtos.test.ts`:
```ts
import {
  IssueMovementSchema,
  ReturnMovementSchema,
  CorrectMovementSchema,
  CreateReservationSchema,
} from './dtos';

describe('IssueMovementSchema', () => {
  it('accepts a valid payload', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'a1b2c3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing idempotencyKey', () => {
    const result = IssueMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
    });
    expect(result.success).toBe(false);
  });
});

describe('ReturnMovementSchema', () => {
  it('accepts outOfService as optional boolean', () => {
    const result = ReturnMovementSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      idempotencyKey: 'k1',
      outOfService: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('CorrectMovementSchema', () => {
  it('accepts a corrected occurredAt and reason', () => {
    const result = CorrectMovementSchema.safeParse({
      occurredAt: '2026-08-01T09:00:00.000Z',
      reason: 'Logged the wrong time',
      idempotencyKey: 'k2',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty body', () => {
    const result = CorrectMovementSchema.safeParse({ idempotencyKey: 'k3' });
    expect(result.success).toBe(false);
  });
});

describe('CreateReservationSchema', () => {
  it('accepts a valid window', () => {
    const result = CreateReservationSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: '2026-10-01T09:00:00.000Z',
      endAt: '2026-10-01T17:00:00.000Z',
      idempotencyKey: 'k4',
    });
    expect(result.success).toBe(true);
  });

  it('rejects endAt <= startAt', () => {
    const result = CreateReservationSchema.safeParse({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: '2026-10-01T17:00:00.000Z',
      endAt: '2026-10-01T09:00:00.000Z',
      idempotencyKey: 'k5',
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w packages/shared`
Expected: FAIL — `Cannot find module './dtos'`.

- [ ] **Step 4: Write `enums.ts` and `dtos.ts`**

`packages/shared/src/enums.ts`:
```ts
export enum MovementType {
  ISSUE = 'ISSUE',
  RETURN = 'RETURN',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  BACK_IN_SERVICE = 'BACK_IN_SERVICE',
}

export enum AssetStatus {
  IN_STORE = 'IN_STORE',
  ISSUED = 'ISSUED',
  RESERVED = 'RESERVED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  FULFILLED = 'FULFILLED',
  EXPIRED = 'EXPIRED',
}
```

`packages/shared/src/dtos.ts`:
```ts
import { z } from 'zod';

export const IssueMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  reservationId: z.string().min(1).optional(),
});
export type IssueMovementDto = z.infer<typeof IssueMovementSchema>;

export const ReturnMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  outOfService: z.boolean().optional(),
});
export type ReturnMovementDto = z.infer<typeof ReturnMovementSchema>;

export const CorrectMovementSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
}).refine((data) => data.occurredAt !== undefined || data.reason !== undefined, {
  message: 'At least one of occurredAt or reason must be provided',
});
export type CorrectMovementDto = z.infer<typeof CorrectMovementSchema>;

export const CreateReservationSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
}).refine((data) => new Date(data.endAt).getTime() > new Date(data.startAt).getTime(), {
  message: 'endAt must be after startAt',
  path: ['endAt'],
});
export type CreateReservationDto = z.infer<typeof CreateReservationSchema>;
```

`packages/shared/src/index.ts`:
```ts
export * from './enums';
export * from './dtos';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w packages/shared`
Expected: PASS — 6 tests across 4 describe blocks.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add movement/reservation enums and zod DTOs"
```

### Task 3: Mongoose schema classes and module wiring

**Files:**
- Create: `apps/api/src/schemas/asset.schema.ts`
- Create: `apps/api/src/schemas/worker.schema.ts`
- Create: `apps/api/src/schemas/movement.schema.ts`
- Create: `apps/api/src/schemas/reservation.schema.ts`
- Create: `apps/api/src/schemas/asset-lock.schema.ts`
- Create: `apps/api/src/database.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/schemas/schemas.integration.test.ts`
- Create: `apps/api/jest.config.js`
- Create: `apps/api/.env.test` (`MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0`)

**Interfaces:**
- Consumes: Task 1's running Dockerized Mongo (`mongodb://localhost:27017/...?replicaSet=rs0`); `MovementType`, `AssetStatus`, `ReservationStatus` from Task 2.
- Produces: injectable Mongoose models `AssetModel`, `WorkerModel`, `MovementModel`, `ReservationModel`, `AssetLockModel` (via `@InjectModel(Asset.name)` etc., all registered by `DatabaseModule`) — every later service task injects these by the exact names `Asset`, `Worker`, `Movement`, `Reservation`, `AssetLock`.

- [ ] **Step 1: Write `apps/api/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  setupFiles: ['dotenv/config'],
};
```

Add `dotenv` to `apps/api/package.json` devDependencies: `"dotenv": "^16.4.5"`.

- [ ] **Step 2: Write the failing integration test**

`apps/api/src/schemas/schemas.integration.test.ts`:
```ts
import mongoose from 'mongoose';
import { AssetSchema, Asset } from './asset.schema';
import { WorkerSchema, Worker } from './worker.schema';
import { MovementSchema, Movement } from './movement.schema';
import { ReservationSchema, Reservation } from './reservation.schema';
import { AssetLockSchema, AssetLock } from './asset-lock.schema';
import { AssetStatus, MovementType, ReservationStatus } from '@equipment-ledger/shared';

describe('Mongoose schemas', () => {
  let conn: mongoose.Connection;
  let AssetModel: mongoose.Model<Asset>;
  let WorkerModel: mongoose.Model<Worker>;
  let MovementModel: mongoose.Model<Movement>;
  let ReservationModel: mongoose.Model<Reservation>;
  let AssetLockModel: mongoose.Model<AssetLock>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    AssetModel = conn.model(Asset.name, AssetSchema);
    WorkerModel = conn.model(Worker.name, WorkerSchema);
    MovementModel = conn.model(Movement.name, MovementSchema);
    ReservationModel = conn.model(Reservation.name, ReservationSchema);
    AssetLockModel = conn.model(AssetLock.name, AssetLockSchema);
  });

  afterAll(async () => {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
      AssetLockModel.deleteMany({}),
    ]);
    await conn.close();
  });

  it('inserts and reads back an Asset with defaults', async () => {
    const asset = await AssetModel.create({ _id: 'HARN-014', kind: 'harness' });
    expect(asset.status).toBe(AssetStatus.IN_STORE);
    expect(asset.currentHolderId).toBeNull();
    expect(asset.currentMovementId).toBeNull();
  });

  it('inserts and reads back a Worker with certifications', async () => {
    const worker = await WorkerModel.create({
      _id: 'worker-ana-rios',
      name: 'Ana Rios',
      certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2027-01-01') }],
    });
    expect(worker.certifications).toHaveLength(1);
    expect(worker.certifications[0].code).toBe('GAS-DETECT');
  });

  it('inserts a Movement and enforces unique idempotencyKey', async () => {
    const now = new Date();
    await MovementModel.create({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      type: MovementType.ISSUE,
      occurredAt: now,
      recordedAt: now,
      idempotencyKey: 'dup-key-1',
    });
    await expect(
      MovementModel.create({
        assetId: 'HARN-014',
        workerId: 'worker-ana-rios',
        type: MovementType.ISSUE,
        occurredAt: now,
        recordedAt: now,
        idempotencyKey: 'dup-key-1',
      }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('inserts a Reservation with default status ACTIVE', async () => {
    const reservation = await ReservationModel.create({
      assetId: 'HARN-014',
      workerId: 'worker-ana-rios',
      startAt: new Date('2026-10-01T09:00:00Z'),
      endAt: new Date('2026-10-01T17:00:00Z'),
      idempotencyKey: 'res-key-1',
    });
    expect(reservation.status).toBe(ReservationStatus.ACTIVE);
  });

  it('inserts an AssetLock keyed by assetId with default nonce 0', async () => {
    const lock = await AssetLockModel.create({ _id: 'HARN-014' });
    expect(lock.nonce).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0 npx jest schemas.integration --config apps/api/jest.config.js` (run from `apps/api`)
Expected: FAIL — `Cannot find module './asset.schema'`.

- [ ] **Step 4: Write the five schema classes**

`apps/api/src/schemas/asset.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AssetStatus } from '@equipment-ledger/shared';

@Schema({ collection: 'assets', _id: false })
export class Asset {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  kind: string;

  @Prop({ type: String, default: null })
  requiresCertification: string | null;

  @Prop({ type: String, enum: AssetStatus, default: AssetStatus.IN_STORE })
  status: AssetStatus;

  @Prop({ type: String, default: null })
  currentHolderId: string | null;

  @Prop({ type: String, default: null })
  currentMovementId: string | null;

  @Prop({ type: Date, default: () => new Date() })
  updatedAt: Date;
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
```

`apps/api/src/schemas/worker.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class Certification {
  @Prop({ type: String, required: true })
  code: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;
}
export const CertificationSchema = SchemaFactory.createForClass(Certification);

@Schema({ collection: 'workers', _id: false })
export class Worker {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: [CertificationSchema], default: [] })
  certifications: Certification[];
}

export const WorkerSchema = SchemaFactory.createForClass(Worker);
```

`apps/api/src/schemas/movement.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MovementType } from '@equipment-ledger/shared';

@Schema({ collection: 'movements' })
export class Movement {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  assetId: string;

  @Prop({ type: String, default: null })
  workerId: string | null;

  @Prop({ type: String, enum: MovementType, required: true })
  type: MovementType;

  @Prop({ type: Date, required: true })
  occurredAt: Date;

  @Prop({ type: Date, required: true })
  recordedAt: Date;

  @Prop({ type: String, required: true, unique: true })
  idempotencyKey: string;

  @Prop({ type: Types.ObjectId, ref: Movement.name, default: null })
  correctionOf: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: Movement.name, default: null })
  correctedBy: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason: string | null;

  @Prop({ type: String, default: null })
  loggedBy: string | null;
}

export const MovementSchema = SchemaFactory.createForClass(Movement);
MovementSchema.index({ assetId: 1, occurredAt: 1 });
```

`apps/api/src/schemas/reservation.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReservationStatus } from '@equipment-ledger/shared';

@Schema({ collection: 'reservations' })
export class Reservation {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  assetId: string;

  @Prop({ type: String, required: true })
  workerId: string;

  @Prop({ type: Date, required: true })
  startAt: Date;

  @Prop({ type: Date, required: true })
  endAt: Date;

  @Prop({ type: String, enum: ReservationStatus, default: ReservationStatus.ACTIVE })
  status: ReservationStatus;

  @Prop({ type: String, required: true, unique: true })
  idempotencyKey: string;

  @Prop({ type: String, default: null })
  cancelReason: string | null;
}

export const ReservationSchema = SchemaFactory.createForClass(Reservation);
```

`apps/api/src/schemas/asset-lock.schema.ts`:
```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'asset_locks', _id: false })
export class AssetLock {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, default: 0 })
  nonce: number;
}

export const AssetLockSchema = SchemaFactory.createForClass(AssetLock);
```

- [ ] **Step 5: Wire `DatabaseModule` and update `AppModule`**

`apps/api/src/database.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { Worker, WorkerSchema } from './schemas/worker.schema';
import { Movement, MovementSchema } from './schemas/movement.schema';
import { Reservation, ReservationSchema } from './schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from './schemas/asset-lock.schema';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0' }),
    }),
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Worker.name, schema: WorkerSchema },
      { name: Movement.name, schema: MovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: AssetLock.name, schema: AssetLockSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0 npx jest schemas.integration --config apps/api/jest.config.js` (from `apps/api`)
Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/schemas apps/api/src/database.module.ts apps/api/src/app.module.ts apps/api/jest.config.js apps/api/package.json
git commit -m "feat(api): add Mongoose schemas for asset, worker, movement, reservation, asset-lock"
```

### Task 4: migrate-mongo index migrations

**Files:**
- Create: `apps/api/migrate-mongo-config.js`
- Create: `apps/api/migrations/20260908000000-create-indexes.js`
- Test: `apps/api/src/migrations.integration.test.ts`

**Interfaces:**
- Consumes: `MONGO_URI` env var (Task 3); the five collections created by Task 3's schemas.
- Produces: on `movements` — unique index on `idempotencyKey`, compound index `{assetId:1, occurredAt:1}` (Mongoose's `autoIndex` already creates these in dev; this migration makes them explicit/repeatable/versioned per the spec's migration story). On `reservations` — unique index on `idempotencyKey`.

- [ ] **Step 1: Write `apps/api/migrate-mongo-config.js`**

```js
module.exports = {
  mongodb: {
    url: process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0',
    databaseName: undefined,
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/migrations.integration.test.ts`:
```ts
import mongoose from 'mongoose';

describe('migrate-mongo indexes', () => {
  let conn: mongoose.Connection;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
  });

  afterAll(async () => {
    await conn.close();
  });

  it('creates a unique index on movements.idempotencyKey', async () => {
    const indexes = await conn.collection('movements').indexes();
    const found = indexes.find((i) => i.key.idempotencyKey === 1);
    expect(found).toBeDefined();
    expect(found?.unique).toBe(true);
  });

  it('creates a compound index on movements {assetId, occurredAt}', async () => {
    const indexes = await conn.collection('movements').indexes();
    const found = indexes.find((i) => i.key.assetId === 1 && i.key.occurredAt === 1);
    expect(found).toBeDefined();
  });

  it('creates a unique index on reservations.idempotencyKey', async () => {
    const indexes = await conn.collection('reservations').indexes();
    const found = indexes.find((i) => i.key.idempotencyKey === 1);
    expect(found).toBeDefined();
    expect(found?.unique).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `apps/api`): `MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0 npx jest migrations.integration --config jest.config.js`
Expected: FAIL — indexes not found (fresh test database, no migration run yet, and no documents inserted yet for `autoIndex` to have created them).

- [ ] **Step 4: Write the migration**

`apps/api/migrations/20260908000000-create-indexes.js`:
```js
module.exports = {
  async up(db) {
    await db.collection('movements').createIndex({ idempotencyKey: 1 }, { unique: true });
    await db.collection('movements').createIndex({ assetId: 1, occurredAt: 1 });
    await db.collection('reservations').createIndex({ idempotencyKey: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection('movements').dropIndex({ idempotencyKey: 1 });
    await db.collection('movements').dropIndex({ assetId: 1, occurredAt: 1 });
    await db.collection('reservations').dropIndex({ idempotencyKey: 1 });
  },
};
```

- [ ] **Step 5: Run the migration against the test database, then verify the test passes**

Run: `MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0 npx migrate-mongo up -f migrate-mongo-config.js` (from `apps/api`)
Expected: `MIGRATED UP: 20260908000000-create-indexes.js`

Run: `MONGO_URI=mongodb://localhost:27017/equipment_ledger_test?replicaSet=rs0 npx jest migrations.integration --config jest.config.js`
Expected: PASS — 3 tests.

- [ ] **Step 6: Run the same migration against the dev database and commit**

Run: `npx migrate-mongo up -f migrate-mongo-config.js` (from `apps/api`, using the default dev `MONGO_URI`)

```bash
git add apps/api/migrate-mongo-config.js apps/api/migrations
git commit -m "feat(api): add migrate-mongo config and initial index migration"
```

---

## Phase 2 — Pure domain algorithms (no DB, fast unit tests)

### Task 5: Certification-expiry check

**Files:**
- Create: `apps/api/src/domain/certification.ts`
- Test: `apps/api/src/domain/certification.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain data shapes.
- Produces: `checkCertification(worker: { certifications: { code: string; expiresAt: Date }[] }, requiredCode: string | null, atDate: Date): { valid: true } | { valid: false; reason: string }` — used by Task 9 (issue).

- [ ] **Step 1: Write the failing test**

`apps/api/src/domain/certification.test.ts`:
```ts
import { checkCertification } from './certification';

describe('checkCertification', () => {
  const worker = {
    certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2026-09-01T00:00:00.000Z') }],
  };

  it('passes when no certification is required', () => {
    expect(checkCertification(worker, null, new Date('2026-09-10'))).toEqual({ valid: true });
  });

  it('passes when the worker holds a non-expired certification', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-08-01'));
    expect(result.valid).toBe(true);
  });

  it('fails when the certification expired before the check date', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-02'));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/expired/i);
  });

  it('fails when the worker does not hold the required certification at all', () => {
    const result = checkCertification(worker, 'HEIGHTS', new Date('2026-08-01'));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/does not hold/i);
  });

  it('treats the exact expiry instant as still valid (expiresAt >= atDate passes)', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-01T00:00:00.000Z'));
    expect(result.valid).toBe(true);
  });

  it('fails one millisecond after the exact expiry instant', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-01T00:00:00.001Z'));
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest domain/certification --config jest.config.js`
Expected: FAIL — `Cannot find module './certification'`.

- [ ] **Step 3: Write `certification.ts`**

```ts
export interface WorkerCertificationInput {
  certifications: { code: string; expiresAt: Date }[];
}

export type CertificationCheckResult = { valid: true } | { valid: false; reason: string };

export function checkCertification(
  worker: WorkerCertificationInput,
  requiredCode: string | null,
  atDate: Date,
): CertificationCheckResult {
  if (requiredCode === null) return { valid: true };

  const cert = worker.certifications.find((c) => c.code === requiredCode);
  if (!cert) {
    return { valid: false, reason: `Worker does not hold the required certification ${requiredCode}` };
  }
  if (cert.expiresAt.getTime() < atDate.getTime()) {
    return {
      valid: false,
      reason: `Certification ${requiredCode} expired ${cert.expiresAt.toISOString().slice(0, 10)}`,
    };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest domain/certification --config jest.config.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/certification.ts apps/api/src/domain/certification.test.ts
git commit -m "feat(api): add pure certification-expiry check"
```

### Task 6: Interval-overlap check

**Files:**
- Create: `apps/api/src/domain/intervals.ts`
- Test: `apps/api/src/domain/intervals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean` — used by Task 12 (reservations) and Task 16 (invariant checker).

- [ ] **Step 1: Write the failing test**

`apps/api/src/domain/intervals.test.ts`:
```ts
import { intervalsOverlap } from './intervals';

const d = (s: string) => new Date(s);

describe('intervalsOverlap', () => {
  it('returns true for clearly overlapping windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T12:00Z'), d('2026-10-01T20:00Z'))).toBe(true);
  });

  it('returns false for adjacent (touching) windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T20:00Z'))).toBe(false);
  });

  it('returns true when one window fully contains the other', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T20:00Z'), d('2026-10-01T12:00Z'), d('2026-10-01T14:00Z'))).toBe(true);
  });

  it('returns true for identical windows', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'))).toBe(true);
  });

  it('returns false for windows far apart', () => {
    expect(intervalsOverlap(d('2026-10-01T09:00Z'), d('2026-10-01T17:00Z'), d('2026-11-01T09:00Z'), d('2026-11-01T17:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest domain/intervals --config jest.config.js`
Expected: FAIL — `Cannot find module './intervals'`.

- [ ] **Step 3: Write `intervals.ts`**

```ts
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest domain/intervals --config jest.config.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/intervals.ts apps/api/src/domain/intervals.test.ts
git commit -m "feat(api): add pure interval-overlap check"
```

### Task 7: Ledger replay / "as of" reconstruction algorithm

**Files:**
- Create: `apps/api/src/domain/replay.ts`
- Test: `apps/api/src/domain/replay.test.ts`

**Interfaces:**
- Consumes: `MovementType` from `@equipment-ledger/shared`.
- Produces (used by Task 15's `StoreService` and Task 16's invariant checker — signatures must match exactly):
  - `interface RawMovement { _id: string; assetId: string; workerId: string | null; type: MovementType; occurredAt: Date; recordedAt: Date; correctionOf: string | null; correctedBy: string | null; }`
  - `interface EffectiveMovement { id: string; assetId: string; workerId: string | null; type: MovementType; occurredAt: Date; }`
  - `resolveEffectiveMovements(rawMovements: RawMovement[]): EffectiveMovement[]`
  - `interface AssetReplayState { status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE'; holderId: string | null; }`
  - `replayStoreState(movements: EffectiveMovement[], asOf: Date): Map<string, AssetReplayState>` — map key is `assetId`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/domain/replay.test.ts`:
```ts
import { MovementType } from '@equipment-ledger/shared';
import { resolveEffectiveMovements, replayStoreState, RawMovement } from './replay';

const d = (s: string) => new Date(s);

function raw(overrides: Partial<RawMovement> & Pick<RawMovement, 'id' | 'assetId' | 'workerId' | 'type' | 'occurredAt'>): RawMovement {
  return {
    recordedAt: overrides.occurredAt,
    correctionOf: null,
    correctedBy: null,
    ...overrides,
  } as RawMovement;
}

describe('resolveEffectiveMovements', () => {
  it('uses the correction occurredAt instead of the original when a correction exists', () => {
    const original = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T09:00Z'), correctedBy: 'm2' });
    const correction = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T11:00Z'), correctionOf: 'm1' });
    const effective = resolveEffectiveMovements([original, correction]);
    const m1Effective = effective.find((m) => m.id === 'm1');
    expect(m1Effective?.occurredAt).toEqual(d('2026-08-01T11:00Z'));
    expect(effective.find((m) => m.id === 'm2')).toBeUndefined();
  });

  it('passes through uncorrected movements unchanged', () => {
    const m = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') });
    expect(resolveEffectiveMovements([m])).toEqual([{ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }]);
  });
});

describe('replayStoreState', () => {
  it('leaves an asset held if asOf is after its ISSUE with no RETURN', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T10:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1' });
  });

  it('excludes a RETURN that happens after asOf', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
      raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T17:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T12:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1' });
  });

  it('is inclusive of a movement exactly at asOf', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-08-01T09:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1' });
  });

  it('returns an empty map (nothing held) when asOf is before the earliest movement', () => {
    const movements = resolveEffectiveMovements([
      raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T09:00Z') }),
    ]);
    const state = replayStoreState(movements, d('2026-01-01T00:00Z'));
    expect(state.get('A1')).toBeUndefined();
  });

  it('uses the corrected occurredAt when deciding inclusion in the asOf window', () => {
    const original = raw({ id: 'm1', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T09:00Z'), correctedBy: 'm2' });
    const correction = raw({ id: 'm2', assetId: 'A1', workerId: 'W1', type: MovementType.RETURN, occurredAt: d('2026-08-01T20:00Z'), correctionOf: 'm1' });
    const issue = raw({ id: 'm0', assetId: 'A1', workerId: 'W1', type: MovementType.ISSUE, occurredAt: d('2026-08-01T08:00Z') });
    const movements = resolveEffectiveMovements([issue, original, correction]);
    const state = replayStoreState(movements, d('2026-08-01T12:00Z'));
    expect(state.get('A1')).toEqual({ status: 'ISSUED', holderId: 'W1' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest domain/replay --config jest.config.js`
Expected: FAIL — `Cannot find module './replay'`.

- [ ] **Step 3: Write `replay.ts`**

```ts
import { MovementType } from '@equipment-ledger/shared';

export interface RawMovement {
  id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  correctionOf: string | null;
  correctedBy: string | null;
}

export interface EffectiveMovement {
  id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
}

export interface AssetReplayState {
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  holderId: string | null;
}

export function resolveEffectiveMovements(rawMovements: RawMovement[]): EffectiveMovement[] {
  const byId = new Map(rawMovements.map((m) => [m.id, m]));
  const result: EffectiveMovement[] = [];

  for (const m of rawMovements) {
    if (m.correctionOf !== null) continue; // corrections are folded into the original's slot, not listed separately
    const effectiveSource = m.correctedBy !== null ? byId.get(m.correctedBy) : undefined;
    const source = effectiveSource ?? m;
    result.push({
      id: m.id,
      assetId: m.assetId,
      workerId: source.workerId,
      type: source.type,
      occurredAt: source.occurredAt,
    });
  }

  return result;
}

export function replayStoreState(movements: EffectiveMovement[], asOf: Date): Map<string, AssetReplayState> {
  const eligible = movements
    .filter((m) => m.occurredAt.getTime() <= asOf.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));

  const state = new Map<string, AssetReplayState>();

  for (const m of eligible) {
    if (m.type === MovementType.ISSUE) {
      state.set(m.assetId, { status: 'ISSUED', holderId: m.workerId });
    } else if (m.type === MovementType.RETURN) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null });
    } else if (m.type === MovementType.OUT_OF_SERVICE) {
      state.set(m.assetId, { status: 'OUT_OF_SERVICE', holderId: null });
    } else if (m.type === MovementType.BACK_IN_SERVICE) {
      state.set(m.assetId, { status: 'IN_STORE', holderId: null });
    }
  }

  return state;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest domain/replay --config jest.config.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/replay.ts apps/api/src/domain/replay.test.ts
git commit -m "feat(api): add ledger replay/reconstruction algorithm"
```

---

## Phase 3 — Write paths

### Task 8: Idempotency helper

**Files:**
- Create: `apps/api/src/domain/idempotency.ts`
- Test: `apps/api/src/domain/idempotency.integration.test.ts`

**Interfaces:**
- Consumes: any Mongoose `Model` with a unique-indexed `idempotencyKey` field (Task 3/4's `Movement`/`Reservation` models).
- Produces: `withIdempotency<T>(model: Model<any>, idempotencyKey: string, execute: () => Promise<T>): Promise<{ replayed: boolean; result: T }>` — used by Tasks 9, 10, 11, 12.

- [ ] **Step 1: Write the failing test**

`apps/api/src/domain/idempotency.integration.test.ts`:
```ts
import mongoose, { Schema } from 'mongoose';
import { withIdempotency } from './idempotency';

describe('withIdempotency', () => {
  let conn: mongoose.Connection;
  let TestModel: mongoose.Model<any>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    const schema = new Schema({ idempotencyKey: { type: String, unique: true }, value: String });
    TestModel = conn.model('IdempotencyTestDoc', schema);
  });

  afterAll(async () => {
    await TestModel.deleteMany({});
    await conn.close();
  });

  it('executes normally when the key is new', async () => {
    const { replayed, result } = await withIdempotency(TestModel, 'key-1', async () => {
      const [doc] = await TestModel.create([{ idempotencyKey: 'key-1', value: 'first' }]);
      return doc.toObject();
    });
    expect(replayed).toBe(false);
    expect(result.value).toBe('first');
  });

  it('replays the existing document on a pre-check hit instead of re-executing', async () => {
    const execute = jest.fn();
    const { replayed, result } = await withIdempotency(TestModel, 'key-1', execute);
    expect(replayed).toBe(true);
    expect(result.value).toBe('first');
    expect(execute).not.toHaveBeenCalled();
  });

  it('replays the existing document when a duplicate-key error happens mid-execute', async () => {
    await TestModel.create({ idempotencyKey: 'key-2', value: 'race-winner' });
    const { replayed, result } = await withIdempotency(TestModel, 'key-2', async () => {
      // Simulates a concurrent request that already inserted 'key-2' by the time this one tries.
      const [doc] = await TestModel.create([{ idempotencyKey: 'key-2', value: 'race-loser' }]);
      return doc.toObject();
    });
    expect(replayed).toBe(true);
    expect(result.value).toBe('race-winner');
  });

  it('propagates non-duplicate-key errors', async () => {
    await expect(
      withIdempotency(TestModel, 'key-3', async () => {
        throw new Error('some other failure');
      }),
    ).rejects.toThrow('some other failure');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest domain/idempotency --config jest.config.js`
Expected: FAIL — `Cannot find module './idempotency'`.

- [ ] **Step 3: Write `idempotency.ts`**

```ts
import { Model } from 'mongoose';

export interface IdempotentOutcome<T> {
  replayed: boolean;
  result: T;
}

export async function withIdempotency<T>(
  model: Model<any>,
  idempotencyKey: string,
  execute: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  const existing = await model.findOne({ idempotencyKey }).lean();
  if (existing) {
    return { replayed: true, result: existing as T };
  }

  try {
    const result = await execute();
    return { replayed: false, result };
  } catch (err: any) {
    if (err?.code === 11000) {
      const existingAfterRace = await model.findOne({ idempotencyKey }).lean();
      if (existingAfterRace) {
        return { replayed: true, result: existingAfterRace as T };
      }
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest domain/idempotency --config jest.config.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/domain/idempotency.ts apps/api/src/domain/idempotency.integration.test.ts
git commit -m "feat(api): add idempotency helper for retried mutating requests"
```

### Task 9: Issue movement (the core concurrency guarantee)

**Files:**
- Create: `apps/api/src/movements/movements.module.ts`
- Create: `apps/api/src/movements/movements.service.ts`
- Create: `apps/api/src/movements/movements.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import `MovementsModule`)
- Test: `apps/api/src/movements/issue.integration.test.ts`
- Test: `apps/api/src/movements/issue.concurrency.test.ts`

**Interfaces:**
- Consumes: `Asset`/`Worker`/`Movement`/`Reservation` models (Task 3), `checkCertification` (Task 5), `withIdempotency` (Task 8), `IssueMovementDto`/`AssetStatus`/`MovementType`/`ReservationStatus` (Task 2).
- Produces: `MovementsService.issue(dto: IssueMovementDto): Promise<MovementResult>` where `MovementResult = { _id: string; assetId: string; workerId: string | null; type: MovementType; occurredAt: Date; recordedAt: Date; idempotencyKey: string }` (`workerId` is nullable to support the system-initiated `OUT_OF_SERVICE`/`BACK_IN_SERVICE` movements Task 13 writes for an asset that isn't currently held by anyone) — reused verbatim by Task 10/11's return/correct methods on the same service, and by Task 24's e2e test. `POST /movements/issue` on `MovementsController`.

- [ ] **Step 1: Write the failing integration test**

`apps/api/src/movements/issue.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.issue', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), movementModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2020-01-01') }] });
  });

  it('issues an in-store asset and returns the movement', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    const result = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', idempotencyKey: 'k1' });
    expect(result.type).toBe('ISSUE');
    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.ISSUED);
    expect(asset?.currentHolderId).toBe('worker-1');
  });

  it('refuses issue when the required certification is expired, and writes no movement', async () => {
    await assetModel.create({ _id: 'GAS-001', kind: 'gas-detector', requiresCertification: 'GAS-DETECT' });
    await expect(service.issue({ assetId: 'GAS-001', workerId: 'worker-2', idempotencyKey: 'k2' })).rejects.toThrow(/expired/i);
    const count = await movementModel.countDocuments({ assetId: 'GAS-001' });
    expect(count).toBe(0);
  });

  it('rejects a second issue of the same asset with 409', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null });
    await service.issue({ assetId: 'DRILL-002', workerId: 'worker-1', idempotencyKey: 'k3' });
    await expect(service.issue({ assetId: 'DRILL-002', workerId: 'worker-2', idempotencyKey: 'k4' })).rejects.toThrow(/not available/i);
  });

  it('replays the original result on a retried idempotencyKey instead of double-issuing', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    const first = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', idempotencyKey: 'k5' });
    const second = await service.issue({ assetId: 'DRILL-003', workerId: 'worker-1', idempotencyKey: 'k5' });
    expect(second._id).toBe(first._id);
    const count = await movementModel.countDocuments({ assetId: 'DRILL-003' });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Write the failing concurrency test**

`apps/api/src/movements/issue.concurrency.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.issue concurrency', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('lets exactly one of 10 simultaneous issue requests for the same asset succeed', async () => {
    await assetModel.deleteMany({});
    await workerModel.deleteMany({});
    await movementModel.deleteMany({});
    await assetModel.create({ _id: 'DRILL-RACE', kind: 'drill', requiresCertification: null });
    for (let i = 0; i < 10; i++) {
      await workerModel.create({ _id: `worker-race-${i}`, name: `Worker ${i}`, certifications: [] });
    }

    const attempts = Array.from({ length: 10 }, (_, i) =>
      service.issue({ assetId: 'DRILL-RACE', workerId: `worker-race-${i}`, idempotencyKey: `race-key-${i}` }),
    );
    const settled = await Promise.allSettled(attempts);

    const succeeded = settled.filter((s) => s.status === 'fulfilled');
    const failed = settled.filter((s) => s.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(9);

    const movementCount = await movementModel.countDocuments({ assetId: 'DRILL-RACE' });
    expect(movementCount).toBe(1);
    const asset = await assetModel.findById('DRILL-RACE').lean();
    expect(asset?.status).toBe(AssetStatus.ISSUED);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (from `apps/api`): `npx jest movements/issue --config jest.config.js`
Expected: FAIL — `Cannot find module './movements.module'`.

- [ ] **Step 4: Write `movements.service.ts`, `movements.module.ts`, `movements.controller.ts`**

`apps/api/src/movements/movements.service.ts`:
```ts
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AssetStatus, IssueMovementDto, MovementType, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Worker } from '../schemas/worker.schema';
import { Movement } from '../schemas/movement.schema';
import { Reservation } from '../schemas/reservation.schema';
import { checkCertification } from '../domain/certification';
import { withIdempotency } from '../domain/idempotency';

export interface MovementResult {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
}

@Injectable()
export class MovementsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async issue(dto: IssueMovementDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    const worker = await this.workerModel.findById(dto.workerId).lean();
    if (!worker) throw new NotFoundException(`Worker ${dto.workerId} not found`);
    const asset = await this.assetModel.findById(dto.assetId).lean();
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    const certCheck = checkCertification(worker, asset.requiresCertification, occurredAt);
    if (!certCheck.valid) {
      throw new UnprocessableEntityException(certCheck.reason);
    }

    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeIssue(dto, occurredAt)),
    );
    return result as MovementResult;
  }

  private async executeIssue(dto: IssueMovementDto, occurredAt: Date): Promise<MovementResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const movementId = new Types.ObjectId();
        const updatedAsset = await this.assetModel.findOneAndUpdate(
          { _id: dto.assetId, status: AssetStatus.IN_STORE },
          {
            $set: {
              status: AssetStatus.ISSUED,
              currentHolderId: dto.workerId,
              currentMovementId: movementId.toString(),
              updatedAt: new Date(),
            },
          },
          { session, new: true },
        );
        if (!updatedAsset) {
          throw new ConflictException(`Asset ${dto.assetId} is not available to issue`);
        }

        const [movement] = await this.movementModel.create(
          [
            {
              _id: movementId,
              assetId: dto.assetId,
              workerId: dto.workerId,
              type: MovementType.ISSUE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason: null,
            },
          ],
          { session },
        );

        if (dto.reservationId) {
          await this.reservationModel.findOneAndUpdate(
            { _id: dto.reservationId, status: ReservationStatus.ACTIVE },
            { $set: { status: ReservationStatus.FULFILLED } },
            { session },
          );
        }

        return movement.toObject() as unknown as MovementResult;
      });
    } finally {
      await session.endSession();
    }
  }

  private async withRetries<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (err?.hasErrorLabel?.('TransientTransactionError') && i < attempts - 1) continue;
        throw err;
      }
    }
    throw lastErr;
  }
}
```

`apps/api/src/movements/movements.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Worker.name, schema: WorkerSchema },
      { name: Movement.name, schema: MovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
  ],
  providers: [MovementsService],
  controllers: [MovementsController],
  exports: [MovementsService],
})
export class MovementsModule {}
```

`apps/api/src/movements/movements.controller.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { IssueMovementDto, IssueMovementSchema } from '@equipment-ledger/shared';
import { MovementsService } from './movements.service';

@Controller('movements')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post('issue')
  issue(@Body() body: unknown) {
    const dto: IssueMovementDto = IssueMovementSchema.parse(body);
    return this.movementsService.issue(dto);
  }
}
```

`apps/api/src/app.module.ts` (append `MovementsModule` to imports):
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';

@Module({
  imports: [DatabaseModule, MovementsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run (from `apps/api`): `npx jest movements/issue --config jest.config.js`
Expected: PASS — 4 integration tests + 1 concurrency test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/movements apps/api/src/app.module.ts
git commit -m "feat(api): add issue-movement endpoint with atomic CAS concurrency guarantee"
```

### Task 10: Return movement

**Files:**
- Modify: `apps/api/src/movements/movements.service.ts` (add `return` + `executeReturn`)
- Modify: `apps/api/src/movements/movements.controller.ts` (add `POST /movements/return`)
- Test: `apps/api/src/movements/return.integration.test.ts`

**Interfaces:**
- Consumes: `MovementResult` (Task 9), `ReturnMovementDto` (Task 2).
- Produces: `MovementsService.return(dto: ReturnMovementDto): Promise<MovementResult>` — reused by Task 13 (out-of-service-while-issued delegates to this), Task 24 (e2e).

- [ ] **Step 1: Write the failing test**

`apps/api/src/movements/return.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.return', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), movementModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [] });
  });

  async function issueDrill(assetId: string, occurredAt: Date) {
    await assetModel.create({ _id: assetId, kind: 'drill', requiresCertification: null });
    return service.issue({ assetId, workerId: 'worker-1', occurredAt: occurredAt.toISOString(), idempotencyKey: `issue-${assetId}` });
  }

  it('returns an issued asset and sets it back to IN_STORE', async () => {
    await issueDrill('DRILL-001', new Date('2026-08-01T09:00:00Z'));
    const result = await service.return({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-1',
    });
    expect(result.type).toBe('RETURN');
    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
    expect(asset?.currentHolderId).toBeNull();
  });

  it('rejects a return by the wrong worker with a distinguishing message', async () => {
    await issueDrill('DRILL-002', new Date('2026-08-01T09:00:00Z'));
    await expect(
      service.return({ assetId: 'DRILL-002', workerId: 'worker-2', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ret-2' }),
    ).rejects.toThrow(/currently held by worker-1/);
  });

  it('rejects returning an asset that is not currently issued', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    await expect(
      service.return({ assetId: 'DRILL-003', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'ret-3' }),
    ).rejects.toThrow(/not currently issued/);
  });

  it('rejects a backdated return before its own issue time', async () => {
    await issueDrill('DRILL-004', new Date('2026-08-01T09:00:00Z'));
    await expect(
      service.return({ assetId: 'DRILL-004', workerId: 'worker-1', occurredAt: '2026-08-01T08:00:00Z', idempotencyKey: 'ret-4' }),
    ).rejects.toThrow(/before the issue time/);
  });

  it('marks the asset OUT_OF_SERVICE when outOfService is true, recording both movements', async () => {
    await issueDrill('DRILL-005', new Date('2026-08-01T09:00:00Z'));
    await service.return({
      assetId: 'DRILL-005',
      workerId: 'worker-1',
      occurredAt: '2026-08-01T17:00:00Z',
      idempotencyKey: 'ret-5',
      outOfService: true,
    });
    const asset = await assetModel.findById('DRILL-005').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const movements = await movementModel.find({ assetId: 'DRILL-005', type: { $in: ['RETURN', 'OUT_OF_SERVICE'] } }).lean();
    expect(movements).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest movements/return --config jest.config.js`
Expected: FAIL — `service.return is not a function`.

- [ ] **Step 3: Add `return`/`executeReturn` to `MovementsService`, and the controller route**

Add to `apps/api/src/movements/movements.service.ts` (new imports: `ReturnMovementDto` from `@equipment-ledger/shared`):

```ts
  async return(dto: ReturnMovementDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeReturn(dto, occurredAt)),
    );
    return result as MovementResult;
  }

  private async executeReturn(dto: ReturnMovementDto, occurredAt: Date): Promise<MovementResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const currentAsset = await this.assetModel.findById(dto.assetId, null, { session });
        if (!currentAsset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
        if (currentAsset.status !== AssetStatus.ISSUED) {
          throw new ConflictException(`Asset ${dto.assetId} is not currently issued (status: ${currentAsset.status})`);
        }
        if (currentAsset.currentHolderId !== dto.workerId) {
          throw new ConflictException(
            `Asset ${dto.assetId} is currently held by ${currentAsset.currentHolderId}, not ${dto.workerId}`,
          );
        }

        const openMovement = currentAsset.currentMovementId
          ? await this.movementModel.findById(currentAsset.currentMovementId, null, { session })
          : null;
        if (!openMovement) {
          throw new ConflictException(`No open movement found for asset ${dto.assetId}`);
        }
        if (occurredAt.getTime() < openMovement.occurredAt.getTime()) {
          throw new UnprocessableEntityException(
            `Return time ${occurredAt.toISOString()} is before the issue time ${openMovement.occurredAt.toISOString()}`,
          );
        }

        const newStatus = dto.outOfService ? AssetStatus.OUT_OF_SERVICE : AssetStatus.IN_STORE;
        const updatedAsset = await this.assetModel.findOneAndUpdate(
          { _id: dto.assetId, status: AssetStatus.ISSUED, currentHolderId: dto.workerId },
          { $set: { status: newStatus, currentHolderId: null, currentMovementId: null, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updatedAsset) {
          throw new ConflictException(`Asset ${dto.assetId} changed concurrently; return not applied`);
        }

        const [returnMovement] = await this.movementModel.create(
          [
            {
              assetId: dto.assetId,
              workerId: dto.workerId,
              type: MovementType.RETURN,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason: null,
            },
          ],
          { session },
        );

        if (dto.outOfService) {
          await this.movementModel.create(
            [
              {
                assetId: dto.assetId,
                workerId: dto.workerId,
                type: MovementType.OUT_OF_SERVICE,
                occurredAt,
                recordedAt: new Date(),
                idempotencyKey: `${dto.idempotencyKey}-oos`,
                correctionOf: null,
                correctedBy: null,
                reason: 'Returned damaged',
              },
            ],
            { session },
          );
        }

        return returnMovement.toObject() as unknown as MovementResult;
      });
    } finally {
      await session.endSession();
    }
  }
```

Add to `apps/api/src/movements/movements.controller.ts`:
```ts
  @Post('return')
  returnMovement(@Body() body: unknown) {
    const dto: ReturnMovementDto = ReturnMovementSchema.parse(body);
    return this.movementsService.return(dto);
  }
```
(import `ReturnMovementDto, ReturnMovementSchema` from `@equipment-ledger/shared` at the top of the controller file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest movements/return --config jest.config.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/movements
git commit -m "feat(api): add return-movement endpoint with wrong-holder and backdate guards"
```

### Task 11: Correction

**Files:**
- Modify: `apps/api/src/movements/movements.service.ts` (add `correct` + `executeCorrect`)
- Modify: `apps/api/src/movements/movements.controller.ts` (add `POST /movements/:id/correct`)
- Test: `apps/api/src/movements/correct.integration.test.ts`

**Interfaces:**
- Consumes: `MovementResult` (Task 9), `CorrectMovementDto` (Task 2).
- Produces: `MovementsService.correct(movementId: string, dto: CorrectMovementDto): Promise<MovementResult>` where the returned object's `correctionOf` field equals `movementId` — used by Task 14's history endpoint (pairing) and Task 24's e2e test.

- [ ] **Step 1: Write the failing test**

`apps/api/src/movements/correct.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MovementsModule } from './movements.module';
import { MovementsService } from './movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';

describe('MovementsService.correct', () => {
  let service: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
        ]),
        MovementsModule,
      ],
    }).compile();

    service = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), movementModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  it('corrects a movement, leaving the original untouched except correctedBy', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-1' });
    const correction = await service.correct(String(original._id), {
      occurredAt: '2026-08-01T09:15:00Z',
      reason: 'Logged the wrong minute',
      idempotencyKey: 'c-correct-1',
    });
    expect(String(correction.assetId)).toBe('DRILL-001');
    expect(new Date(correction.occurredAt).toISOString()).toBe('2026-08-01T09:15:00.000Z');

    const reloadedOriginal = await movementModel.findById(original._id).lean();
    expect(String(reloadedOriginal?.correctedBy)).toBe(String(correction._id));
    expect(new Date(reloadedOriginal!.occurredAt).toISOString()).toBe('2026-08-01T09:00:00.000Z');
  });

  it('rejects correcting a movement that has already been corrected', async () => {
    const original = await service.issue({ assetId: 'DRILL-001', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'c-issue-2' });
    await service.correct(String(original._id), { occurredAt: '2026-08-01T09:15:00Z', idempotencyKey: 'c-correct-2' });
    await expect(
      service.correct(String(original._id), { occurredAt: '2026-08-01T09:20:00Z', idempotencyKey: 'c-correct-3' }),
    ).rejects.toThrow(/already been corrected/);
  });

  it('returns 404 (NotFoundException) when correcting a nonexistent movement', async () => {
    await expect(
      service.correct('64b64b64b64b64b64b64b64', { occurredAt: '2026-08-01T09:20:00Z', idempotencyKey: 'c-correct-4' }),
    ).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest movements/correct --config jest.config.js`
Expected: FAIL — `service.correct is not a function`.

- [ ] **Step 3: Add `correct`/`executeCorrect` to `MovementsService`, and the controller route**

Add to `apps/api/src/movements/movements.service.ts` (new import: `CorrectMovementDto` from `@equipment-ledger/shared`):

```ts
  async correct(movementId: string, dto: CorrectMovementDto): Promise<MovementResult> {
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.executeCorrect(movementId, dto),
    );
    return result as MovementResult;
  }

  private async executeCorrect(movementId: string, dto: CorrectMovementDto): Promise<MovementResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const original = await this.movementModel.findById(movementId, null, { session });
        if (!original) throw new NotFoundException(`Movement ${movementId} not found`);
        if (original.correctedBy) {
          throw new ConflictException(`Movement ${movementId} has already been corrected`);
        }

        const correctionId = new Types.ObjectId();
        const [correction] = await this.movementModel.create(
          [
            {
              _id: correctionId,
              assetId: original.assetId,
              workerId: original.workerId,
              type: original.type,
              occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : original.occurredAt,
              recordedAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
              correctionOf: original._id,
              correctedBy: null,
              reason: dto.reason ?? null,
            },
          ],
          { session },
        );

        await this.movementModel.updateOne({ _id: original._id }, { $set: { correctedBy: correctionId } }, { session });

        return correction.toObject() as unknown as MovementResult;
      });
    } finally {
      await session.endSession();
    }
  }
```

Add to `apps/api/src/movements/movements.controller.ts`:
```ts
  @Post(':id/correct')
  correct(@Param('id') id: string, @Body() body: unknown) {
    const dto: CorrectMovementDto = CorrectMovementSchema.parse(body);
    return this.movementsService.correct(id, dto);
  }
```
(import `Param` from `@nestjs/common`, and `CorrectMovementDto, CorrectMovementSchema` from `@equipment-ledger/shared`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest movements/correct --config jest.config.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/movements
git commit -m "feat(api): add movement-correction endpoint"
```

### Task 12: Reservations (overlap enforcement + concurrency)

**Files:**
- Create: `apps/api/src/reservations/reservations.module.ts`
- Create: `apps/api/src/reservations/reservations.service.ts`
- Create: `apps/api/src/reservations/reservations.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import `ReservationsModule`)
- Test: `apps/api/src/reservations/reservations.integration.test.ts`
- Test: `apps/api/src/reservations/reservations.concurrency.test.ts`

**Interfaces:**
- Consumes: `Asset`/`Reservation`/`AssetLock` models (Task 3), `intervalsOverlap` (Task 6), `withIdempotency` (Task 8), `CreateReservationDto`/`AssetStatus`/`ReservationStatus` (Task 2).
- Produces: `ReservationResult = { _id: string; assetId: string; workerId: string; startAt: Date; endAt: Date; status: ReservationStatus; idempotencyKey: string }`; `ReservationsService.reserve(dto: CreateReservationDto): Promise<ReservationResult>`; `ReservationsService.findAll(): Promise<ReservationResult[]>` — reused by Task 13 (cancelling on out-of-service) and Task 24 (e2e).

- [ ] **Step 1: Write the failing integration test**

`apps/api/src/reservations/reservations.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus } from '@equipment-ledger/shared';
import { ReservationsModule } from './reservations.module';
import { ReservationsService } from './reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

describe('ReservationsService.reserve', () => {
  let service: ReservationsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Reservation.name, schema: ReservationSchema },
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        ReservationsModule,
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), reservationModel.deleteMany({})]);
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
  });

  it('creates a reservation for a future window', async () => {
    const result = await service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      startAt: '2027-01-10T09:00:00Z',
      endAt: '2027-01-10T17:00:00Z',
      idempotencyKey: 'res-1',
    });
    expect(result.status).toBe('ACTIVE');
  });

  it('rejects a reservation overlapping an existing one, naming the conflicting window', async () => {
    await service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-2' });
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-2', startAt: '2027-01-10T12:00:00Z', endAt: '2027-01-10T20:00:00Z', idempotencyKey: 'res-3' }),
    ).rejects.toThrow(/Overlaps an existing reservation from 2027-01-10T09:00:00.000Z to 2027-01-10T17:00:00.000Z/);
  });

  it('allows two adjacent (touching, non-overlapping) reservations', async () => {
    await service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-4' });
    const second = await service.reserve({
      assetId: 'DRILL-001',
      workerId: 'worker-2',
      startAt: '2027-01-10T17:00:00Z',
      endAt: '2027-01-10T20:00:00Z',
      idempotencyKey: 'res-5',
    });
    expect(second.status).toBe('ACTIVE');
  });

  it('rejects reserving an out-of-service asset', async () => {
    await assetModel.updateOne({ _id: 'DRILL-001' }, { $set: { status: AssetStatus.OUT_OF_SERVICE } });
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T09:00:00Z', endAt: '2027-01-10T17:00:00Z', idempotencyKey: 'res-6' }),
    ).rejects.toThrow(/out of service/);
  });

  it('rejects endAt <= startAt before touching the database', async () => {
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2027-01-10T17:00:00Z', endAt: '2027-01-10T09:00:00Z', idempotencyKey: 'res-7' }),
    ).rejects.toThrow(/endAt must be after startAt/);
  });

  it('rejects a startAt in the past before touching the database', async () => {
    await expect(
      service.reserve({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: '2020-01-10T17:00:00Z', endAt: '2020-01-10T20:00:00Z', idempotencyKey: 'res-8' }),
    ).rejects.toThrow(/startAt cannot be in the past/);
  });
});
```

- [ ] **Step 2: Write the failing concurrency test**

`apps/api/src/reservations/reservations.concurrency.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ReservationsModule } from './reservations.module';
import { ReservationsService } from './reservations.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

describe('ReservationsService.reserve concurrency', () => {
  let service: ReservationsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Reservation.name, schema: ReservationSchema },
          { name: AssetLock.name, schema: AssetLockSchema },
        ]),
        ReservationsModule,
      ],
    }).compile();

    service = moduleRef.get(ReservationsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('lets exactly one of two simultaneous overlapping reservation requests succeed', async () => {
    await assetModel.deleteMany({});
    await reservationModel.deleteMany({});
    await assetModel.create({ _id: 'DRILL-RACE', kind: 'drill', requiresCertification: null });

    const [a, b] = await Promise.allSettled([
      service.reserve({ assetId: 'DRILL-RACE', workerId: 'worker-a', startAt: '2027-02-01T09:00:00Z', endAt: '2027-02-01T17:00:00Z', idempotencyKey: 'race-a' }),
      service.reserve({ assetId: 'DRILL-RACE', workerId: 'worker-b', startAt: '2027-02-01T10:00:00Z', endAt: '2027-02-01T18:00:00Z', idempotencyKey: 'race-b' }),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

    const count = await reservationModel.countDocuments({ assetId: 'DRILL-RACE', status: 'ACTIVE' });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (from `apps/api`): `npx jest reservations --config jest.config.js`
Expected: FAIL — `Cannot find module './reservations.module'`.

- [ ] **Step 4: Write `reservations.service.ts`, `reservations.module.ts`, `reservations.controller.ts`**

`apps/api/src/reservations/reservations.service.ts`:
```ts
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, CreateReservationDto, ReservationStatus } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetLock } from '../schemas/asset-lock.schema';
import { intervalsOverlap } from '../domain/intervals';
import { withIdempotency } from '../domain/idempotency';

export interface ReservationResult {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: Date;
  endAt: Date;
  status: ReservationStatus;
  idempotencyKey: string;
}

@Injectable()
export class ReservationsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectModel(AssetLock.name) private readonly assetLockModel: Model<AssetLock>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async reserve(dto: CreateReservationDto): Promise<ReservationResult> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (endAt.getTime() <= startAt.getTime()) {
      throw new UnprocessableEntityException('endAt must be after startAt');
    }
    if (startAt.getTime() < Date.now()) {
      throw new UnprocessableEntityException('startAt cannot be in the past');
    }

    const { result } = await withIdempotency(this.reservationModel, dto.idempotencyKey, () =>
      this.withRetries(() => this.executeReserve(dto, startAt, endAt)),
    );
    return result as ReservationResult;
  }

  async findAll(): Promise<ReservationResult[]> {
    const docs = await this.reservationModel.find({}).lean();
    return docs as unknown as ReservationResult[];
  }

  private async executeReserve(dto: CreateReservationDto, startAt: Date, endAt: Date): Promise<ReservationResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const asset = await this.assetModel.findById(dto.assetId, null, { session });
        if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
        if (asset.status === AssetStatus.OUT_OF_SERVICE) {
          throw new ConflictException(`Asset ${dto.assetId} is out of service and cannot be reserved`);
        }

        await this.assetLockModel.findOneAndUpdate(
          { _id: dto.assetId },
          { $inc: { nonce: 1 } },
          { session, upsert: true, new: true },
        );

        const activeReservations = await this.reservationModel
          .find({ assetId: dto.assetId, status: ReservationStatus.ACTIVE }, null, { session })
          .lean();

        const conflicting = activeReservations.find((r) => intervalsOverlap(startAt, endAt, r.startAt, r.endAt));
        if (conflicting) {
          throw new ConflictException(
            `Overlaps an existing reservation from ${conflicting.startAt.toISOString()} to ${conflicting.endAt.toISOString()}`,
          );
        }

        const [reservation] = await this.reservationModel.create(
          [{ assetId: dto.assetId, workerId: dto.workerId, startAt, endAt, idempotencyKey: dto.idempotencyKey }],
          { session },
        );

        return reservation.toObject() as unknown as ReservationResult;
      });
    } finally {
      await session.endSession();
    }
  }

  private async withRetries<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (err?.hasErrorLabel?.('TransientTransactionError') && i < attempts - 1) continue;
        throw err;
      }
    }
    throw lastErr;
  }
}
```

`apps/api/src/reservations/reservations.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: AssetLock.name, schema: AssetLockSchema },
    ]),
  ],
  providers: [ReservationsService],
  controllers: [ReservationsController],
  exports: [ReservationsService],
})
export class ReservationsModule {}
```

`apps/api/src/reservations/reservations.controller.ts`:
```ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateReservationDto, CreateReservationSchema } from '@equipment-ledger/shared';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  reserve(@Body() body: unknown) {
    const dto: CreateReservationDto = CreateReservationSchema.parse(body);
    return this.reservationsService.reserve(dto);
  }

  @Get()
  findAll() {
    return this.reservationsService.findAll();
  }
}
```

`apps/api/src/app.module.ts` (append `ReservationsModule`):
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run (from `apps/api`): `npx jest reservations --config jest.config.js`
Expected: PASS — 7 integration tests + 1 concurrency test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reservations apps/api/src/app.module.ts
git commit -m "feat(api): add reservations endpoint with lock-document transaction serialization"
```

### Task 13: Out-of-service transitions

**Files:**
- Modify: `packages/shared/src/dtos.ts` (add `TakeOutOfServiceSchema`, `BringBackIntoServiceSchema`)
- Modify: `packages/shared/src/index.ts` (already re-exports `./dtos`, no change needed)
- Create: `apps/api/src/assets/assets.module.ts`
- Create: `apps/api/src/assets/assets.service.ts`
- Create: `apps/api/src/assets/assets.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import `AssetsModule`)
- Test: `apps/api/src/assets/out-of-service.integration.test.ts`

**Interfaces:**
- Consumes: `MovementResult`, `MovementsService.return` (Task 9/10); `Asset`/`Movement`/`Reservation` models (Task 3); `withIdempotency` (Task 8); `AssetStatus`/`MovementType`/`ReservationStatus` (Task 2).
- Produces: `TakeOutOfServiceDto = { occurredAt?: string; reason?: string; idempotencyKey: string }`, `BringBackIntoServiceDto = { occurredAt?: string; idempotencyKey: string }` from `@equipment-ledger/shared`; `AssetsService.takeOutOfService(assetId: string, dto: TakeOutOfServiceDto): Promise<MovementResult>`, `AssetsService.bringBackIntoService(assetId: string, dto: BringBackIntoServiceDto): Promise<MovementResult>` — `AssetsService` itself (this module) is extended by Task 14 with `findAll`/`findOne`/`getHistory`.

- [ ] **Step 1: Add the two DTOs to shared**

Add to `packages/shared/src/dtos.ts`:
```ts
export const TakeOutOfServiceSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
});
export type TakeOutOfServiceDto = z.infer<typeof TakeOutOfServiceSchema>;

export const BringBackIntoServiceSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
});
export type BringBackIntoServiceDto = z.infer<typeof BringBackIntoServiceSchema>;
```

Run: `npm run build -w packages/shared` — should compile cleanly (no test needed for this addition; it's exercised by Step 4's integration test below).

- [ ] **Step 2: Write the failing test**

`apps/api/src/assets/out-of-service.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, ReservationStatus } from '@equipment-ledger/shared';
import { AssetsModule } from './assets.module';
import { AssetsService } from './assets.service';
import { MovementsModule } from '../movements/movements.module';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('AssetsService out-of-service transitions', () => {
  let service: AssetsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let movementModel: Model<Movement>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
          { name: Reservation.name, schema: ReservationSchema },
        ]),
        MovementsModule,
        AssetsModule,
      ],
    }).compile();

    service = moduleRef.get(AssetsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    movementModel = moduleRef.get(getModelToken(Movement.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([
      assetModel.deleteMany({}),
      workerModel.deleteMany({}),
      movementModel.deleteMany({}),
      reservationModel.deleteMany({}),
    ]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
  });

  it('cancels standing ACTIVE reservations when taking an IN_STORE asset out of service', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    await reservationModel.create({
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      startAt: new Date('2027-01-10T09:00:00Z'),
      endAt: new Date('2027-01-10T17:00:00Z'),
      idempotencyKey: 'res-standing-1',
    });

    await service.takeOutOfService('DRILL-001', { reason: 'Broken chuck', idempotencyKey: 'oos-1' });

    const asset = await assetModel.findById('DRILL-001').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const reservation = await reservationModel.findOne({ assetId: 'DRILL-001' }).lean();
    expect(reservation?.status).toBe(ReservationStatus.CANCELLED);
    expect(reservation?.cancelReason).toMatch(/out of service/i);
  });

  it('behaves like a return when taking an ISSUED asset out of service', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null, status: AssetStatus.ISSUED, currentHolderId: 'worker-1' });
    const [openMovement] = await movementModel.create([
      { assetId: 'DRILL-002', workerId: 'worker-1', type: 'ISSUE', occurredAt: new Date('2026-08-01T09:00:00Z'), recordedAt: new Date('2026-08-01T09:00:00Z'), idempotencyKey: 'oos-issue-2' },
    ]);
    await assetModel.updateOne({ _id: 'DRILL-002' }, { $set: { currentMovementId: String(openMovement._id) } });

    await service.takeOutOfService('DRILL-002', { occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'oos-2' });

    const asset = await assetModel.findById('DRILL-002').lean();
    expect(asset?.status).toBe(AssetStatus.OUT_OF_SERVICE);
    const movements = await movementModel.find({ assetId: 'DRILL-002', type: { $in: ['RETURN', 'OUT_OF_SERVICE'] } }).lean();
    expect(movements).toHaveLength(2);
  });

  it('rejects taking an already-out-of-service asset out of service again', async () => {
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null, status: AssetStatus.OUT_OF_SERVICE });
    await expect(service.takeOutOfService('DRILL-003', { idempotencyKey: 'oos-3' })).rejects.toThrow(/already out of service/);
  });

  it('brings an out-of-service asset back into service', async () => {
    await assetModel.create({ _id: 'DRILL-004', kind: 'drill', requiresCertification: null, status: AssetStatus.OUT_OF_SERVICE });
    await service.bringBackIntoService('DRILL-004', { idempotencyKey: 'bis-1' });
    const asset = await assetModel.findById('DRILL-004').lean();
    expect(asset?.status).toBe(AssetStatus.IN_STORE);
  });

  it('rejects bringing an already-in-store asset back into service', async () => {
    await assetModel.create({ _id: 'DRILL-005', kind: 'drill', requiresCertification: null });
    await expect(service.bringBackIntoService('DRILL-005', { idempotencyKey: 'bis-2' })).rejects.toThrow(/not currently out of service/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `apps/api`): `npx jest assets/out-of-service --config jest.config.js`
Expected: FAIL — `Cannot find module './assets.module'`.

- [ ] **Step 4: Write `assets.service.ts`, `assets.module.ts`, `assets.controller.ts`**

`apps/api/src/assets/assets.service.ts`:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetStatus, BringBackIntoServiceDto, MovementType, ReservationStatus, TakeOutOfServiceDto } from '@equipment-ledger/shared';
import { Asset } from '../schemas/asset.schema';
import { Movement } from '../schemas/movement.schema';
import { Reservation } from '../schemas/reservation.schema';
import { withIdempotency } from '../domain/idempotency';
import { MovementsService, MovementResult } from '../movements/movements.service';

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<Asset>,
    @InjectModel(Movement.name) private readonly movementModel: Model<Movement>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    @InjectConnection() private readonly connection: Connection,
    private readonly movementsService: MovementsService,
  ) {}

  async takeOutOfService(assetId: string, dto: TakeOutOfServiceDto): Promise<MovementResult> {
    const asset = await this.assetModel.findById(assetId).lean();
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    if (asset.status === AssetStatus.ISSUED) {
      return this.movementsService.return({
        assetId,
        workerId: asset.currentHolderId!,
        occurredAt: dto.occurredAt,
        idempotencyKey: dto.idempotencyKey,
        outOfService: true,
      });
    }

    if (asset.status === AssetStatus.OUT_OF_SERVICE) {
      throw new ConflictException(`Asset ${assetId} is already out of service`);
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.executeTakeOutOfServiceInStore(assetId, occurredAt, dto.reason ?? null, dto.idempotencyKey),
    );
    return result as MovementResult;
  }

  private async executeTakeOutOfServiceInStore(
    assetId: string,
    occurredAt: Date,
    reason: string | null,
    idempotencyKey: string,
  ): Promise<MovementResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const updated = await this.assetModel.findOneAndUpdate(
          { _id: assetId, status: AssetStatus.IN_STORE },
          { $set: { status: AssetStatus.OUT_OF_SERVICE, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updated) {
          throw new ConflictException(`Asset ${assetId} is not available to take out of service`);
        }

        await this.reservationModel.updateMany(
          { assetId, status: ReservationStatus.ACTIVE },
          { $set: { status: ReservationStatus.CANCELLED, cancelReason: 'Asset taken out of service' } },
          { session },
        );

        const [movement] = await this.movementModel.create(
          [
            {
              assetId,
              workerId: null,
              type: MovementType.OUT_OF_SERVICE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason,
            },
          ],
          { session },
        );

        return movement.toObject() as unknown as MovementResult;
      });
    } finally {
      await session.endSession();
    }
  }

  async bringBackIntoService(assetId: string, dto: BringBackIntoServiceDto): Promise<MovementResult> {
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    const { result } = await withIdempotency(this.movementModel, dto.idempotencyKey, () =>
      this.executeBringBackIntoService(assetId, occurredAt, dto.idempotencyKey),
    );
    return result as MovementResult;
  }

  private async executeBringBackIntoService(assetId: string, occurredAt: Date, idempotencyKey: string): Promise<MovementResult> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const updated = await this.assetModel.findOneAndUpdate(
          { _id: assetId, status: AssetStatus.OUT_OF_SERVICE },
          { $set: { status: AssetStatus.IN_STORE, updatedAt: new Date() } },
          { session, new: true },
        );
        if (!updated) {
          throw new ConflictException(`Asset ${assetId} is not currently out of service`);
        }

        const [movement] = await this.movementModel.create(
          [
            {
              assetId,
              workerId: null,
              type: MovementType.BACK_IN_SERVICE,
              occurredAt,
              recordedAt: new Date(),
              idempotencyKey,
              correctionOf: null,
              correctedBy: null,
              reason: null,
            },
          ],
          { session },
        );

        return movement.toObject() as unknown as MovementResult;
      });
    } finally {
      await session.endSession();
    }
  }
}
```

`apps/api/src/assets/assets.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { MovementsModule } from '../movements/movements.module';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Movement.name, schema: MovementSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    MovementsModule,
  ],
  providers: [AssetsService],
  controllers: [AssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
```

`apps/api/src/assets/assets.controller.ts`:
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { BringBackIntoServiceSchema, TakeOutOfServiceSchema } from '@equipment-ledger/shared';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post(':id/out-of-service')
  takeOutOfService(@Param('id') id: string, @Body() body: unknown) {
    const dto = TakeOutOfServiceSchema.parse(body);
    return this.assetsService.takeOutOfService(id, dto);
  }

  @Post(':id/back-in-service')
  bringBackIntoService(@Param('id') id: string, @Body() body: unknown) {
    const dto = BringBackIntoServiceSchema.parse(body);
    return this.assetsService.bringBackIntoService(id, dto);
  }
}
```

`apps/api/src/app.module.ts` (append `AssetsModule`):
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';
import { AssetsModule } from './assets/assets.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule, AssetsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `apps/api`): `npx jest assets/out-of-service --config jest.config.js`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dtos.ts apps/api/src/assets apps/api/src/app.module.ts
git commit -m "feat(api): add out-of-service and back-in-service asset transitions"
```

---

## Phase 4 — Read paths

### Task 14: Current state, asset history, and worker reads

**Files:**
- Modify: `apps/api/src/assets/assets.service.ts` (add `findAll`, `findOne`, `getHistory`)
- Modify: `apps/api/src/assets/assets.controller.ts` (add `GET /assets`, `GET /assets/:id`, `GET /assets/:id/history`)
- Create: `apps/api/src/workers/workers.module.ts`
- Create: `apps/api/src/workers/workers.service.ts`
- Create: `apps/api/src/workers/workers.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import `WorkersModule`)
- Test: `apps/api/src/assets/assets-read.integration.test.ts`
- Test: `apps/api/src/workers/workers.integration.test.ts`

**Interfaces:**
- Consumes: `Asset`/`Reservation`/`Movement`/`Worker` models (Task 3); `MovementResult` (Task 9); `ReservationStatus`/`AssetStatus` (Task 2).
- Produces: `AssetSummary = { _id: string; kind: string; requiresCertification: string | null; status: AssetStatus; currentHolderId: string | null; upcomingReservation: { startAt: Date; endAt: Date; workerId: string } | null }`, `AssetsService.findAll(): Promise<AssetSummary[]>`, `AssetsService.findOne(id: string): Promise<AssetSummary>`, `HistoryEntry = { movement: MovementResult; correction: MovementResult | null }`, `AssetsService.getHistory(assetId: string): Promise<HistoryEntry[]>` — reused by Task 15 (consistency check against `findOne`) and Task 24 (e2e). `WorkerSummary = { _id: string; name: string; certifications: { code: string; expiresAt: Date }[]; currentlyHolding: AssetSummary[]; reservations: ReservationResult[] }`, `WorkersService.findAll()`, `WorkersService.findOne(id: string): Promise<WorkerSummary>`.

- [ ] **Step 1: Write the failing asset-read test**

`apps/api/src/assets/assets-read.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AssetsModule } from './assets.module';
import { AssetsService } from './assets.service';
import { MovementsModule } from '../movements/movements.module';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('AssetsService reads', () => {
  let service: AssetsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;
  let reservationModel: Model<Reservation>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
          { name: Reservation.name, schema: ReservationSchema },
        ]),
        MovementsModule,
        AssetsModule,
      ],
    }).compile();

    service = moduleRef.get(AssetsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
    reservationModel = moduleRef.get(getModelToken(Reservation.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  beforeEach(async () => {
    await Promise.all([assetModel.deleteMany({}), workerModel.deleteMany({}), reservationModel.deleteMany({})]);
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
  });

  it('findAll annotates the nearest upcoming ACTIVE reservation per asset', async () => {
    await assetModel.create({ _id: 'DRILL-001', kind: 'drill', requiresCertification: null });
    await reservationModel.create({ assetId: 'DRILL-001', workerId: 'worker-1', startAt: new Date('2027-03-01T09:00Z'), endAt: new Date('2027-03-01T17:00Z'), idempotencyKey: 'r1' });
    const all = await service.findAll();
    const drill = all.find((a) => a._id === 'DRILL-001');
    expect(drill?.upcomingReservation?.workerId).toBe('worker-1');
  });

  it('findOne throws NotFoundException for an unknown asset', async () => {
    await expect(service.findOne('NOPE-001')).rejects.toThrow(/not found/i);
  });

  it('getHistory pairs a corrected movement with its correction', async () => {
    await assetModel.create({ _id: 'DRILL-002', kind: 'drill', requiresCertification: null });
    const issued = await service['movementsService'].issue({ assetId: 'DRILL-002', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'hist-issue-1' });
    await service['movementsService'].correct(String(issued._id), { occurredAt: '2026-08-01T09:05:00Z', idempotencyKey: 'hist-correct-1' });

    const history = await service.getHistory('DRILL-002');
    expect(history).toHaveLength(1);
    expect(String(history[0].movement._id)).toBe(String(issued._id));
    expect(history[0].correction).not.toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing worker-read test**

`apps/api/src/workers/workers.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { WorkersModule } from './workers.module';
import { WorkersService } from './workers.service';
import { MovementsModule } from '../movements/movements.module';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('WorkersService', () => {
  let service: WorkersService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
          { name: Reservation.name, schema: ReservationSchema },
        ]),
        MovementsModule,
        WorkersModule,
      ],
    }).compile();

    service = moduleRef.get(WorkersService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('findOne reports the assets a worker currently holds', async () => {
    await workerModel.create({ _id: 'worker-2', name: 'Ben Cole', certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2020-01-01') }] });
    await assetModel.create({ _id: 'DRILL-003', kind: 'drill', requiresCertification: null });
    await service['movementsService'].issue({ assetId: 'DRILL-003', workerId: 'worker-2', idempotencyKey: 'wk-issue-1' });

    const worker = await service.findOne('worker-2');
    expect(worker.currentlyHolding).toHaveLength(1);
    expect(worker.currentlyHolding[0]._id).toBe('DRILL-003');
  });

  it('findOne throws NotFoundException for an unknown worker', async () => {
    await expect(service.findOne('nope')).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (from `apps/api`): `npx jest assets-read workers.integration --config jest.config.js`
Expected: FAIL — `findAll is not a function` / `Cannot find module './workers.module'`.

- [ ] **Step 4: Add `findAll`/`findOne`/`getHistory` to `AssetsService`, add the `GET` routes, and write the `WorkersModule`**

Add to `apps/api/src/assets/assets.service.ts` (new import: `Reservation` model already injected; add `AssetSummary`/`HistoryEntry` exports):

```ts
export interface AssetSummary {
  _id: string;
  kind: string;
  requiresCertification: string | null;
  status: AssetStatus;
  currentHolderId: string | null;
  upcomingReservation: { startAt: Date; endAt: Date; workerId: string } | null;
}

export interface HistoryEntry {
  movement: MovementResult;
  correction: MovementResult | null;
}
```

```ts
  async findAll(): Promise<AssetSummary[]> {
    const assets = await this.assetModel.find({}).lean();
    const now = new Date();
    const activeReservations = await this.reservationModel
      .find({ status: ReservationStatus.ACTIVE, endAt: { $gte: now } })
      .sort({ startAt: 1 })
      .lean();

    const nearestByAsset = new Map<string, (typeof activeReservations)[number]>();
    for (const r of activeReservations) {
      if (!nearestByAsset.has(r.assetId)) nearestByAsset.set(r.assetId, r);
    }

    return assets.map((a) => {
      const nearest = nearestByAsset.get(a._id);
      return {
        _id: a._id,
        kind: a.kind,
        requiresCertification: a.requiresCertification,
        status: a.status,
        currentHolderId: a.currentHolderId,
        upcomingReservation: nearest ? { startAt: nearest.startAt, endAt: nearest.endAt, workerId: nearest.workerId } : null,
      };
    });
  }

  async findOne(id: string): Promise<AssetSummary> {
    const all = await this.findAll();
    const found = all.find((a) => a._id === id);
    if (!found) throw new NotFoundException(`Asset ${id} not found`);
    return found;
  }

  async getHistory(assetId: string): Promise<HistoryEntry[]> {
    const asset = await this.assetModel.findById(assetId).lean();
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    const movements = await this.movementModel.find({ assetId }).sort({ recordedAt: 1 }).lean();
    const byId = new Map(movements.map((m) => [String(m._id), m]));

    const entries: HistoryEntry[] = [];
    for (const m of movements) {
      if (m.correctionOf) continue;
      const correction = m.correctedBy ? byId.get(String(m.correctedBy)) : undefined;
      entries.push({
        movement: m as unknown as MovementResult,
        correction: correction ? (correction as unknown as MovementResult) : null,
      });
    }
    return entries;
  }
```

Note: `AssetsService` already has `this.reservationModel` injected (Task 13) — no constructor change needed.

Add to `apps/api/src/assets/assets.controller.ts`:
```ts
  @Get()
  findAll() {
    return this.assetsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assetsService.findOne(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.assetsService.getHistory(id);
  }
```
(import `Get` from `@nestjs/common` alongside the existing `Body, Controller, Param, Post`.)

`apps/api/src/workers/workers.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Worker } from '../schemas/worker.schema';
import { Reservation } from '../schemas/reservation.schema';
import { AssetsService, AssetSummary } from '../assets/assets.service';
import { ReservationResult } from '../reservations/reservations.service';

export interface WorkerSummary {
  _id: string;
  name: string;
  certifications: { code: string; expiresAt: Date }[];
  currentlyHolding: AssetSummary[];
  reservations: ReservationResult[];
}

@Injectable()
export class WorkersService {
  constructor(
    @InjectModel(Worker.name) private readonly workerModel: Model<Worker>,
    @InjectModel(Reservation.name) private readonly reservationModel: Model<Reservation>,
    private readonly assetsService: AssetsService,
  ) {}

  async findAll(): Promise<Worker[]> {
    return this.workerModel.find({}).lean();
  }

  async findOne(id: string): Promise<WorkerSummary> {
    const worker = await this.workerModel.findById(id).lean();
    if (!worker) throw new NotFoundException(`Worker ${id} not found`);

    const allAssets = await this.assetsService.findAll();
    const currentlyHolding = allAssets.filter((a) => a.currentHolderId === id);
    const reservations = (await this.reservationModel.find({ workerId: id }).lean()) as unknown as ReservationResult[];

    return { _id: worker._id, name: worker.name, certifications: worker.certifications, currentlyHolding, reservations };
  }
}
```

`apps/api/src/workers/workers.controller.ts`:
```ts
import { Controller, Get, Param } from '@nestjs/common';
import { WorkersService } from './workers.service';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Get()
  findAll() {
    return this.workersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workersService.findOne(id);
  }
}
```

`apps/api/src/workers/workers.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetsModule } from '../assets/assets.module';
import { WorkersService } from './workers.service';
import { WorkersController } from './workers.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Worker.name, schema: WorkerSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
    AssetsModule,
  ],
  providers: [WorkersService],
  controllers: [WorkersController],
  exports: [WorkersService],
})
export class WorkersModule {}
```

`apps/api/src/app.module.ts` (append `WorkersModule`):
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';
import { AssetsModule } from './assets/assets.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule, AssetsModule, WorkersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run (from `apps/api`): `npx jest assets-read workers.integration --config jest.config.js`
Expected: PASS — 3 asset-read tests + 2 worker tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/assets apps/api/src/workers apps/api/src/app.module.ts
git commit -m "feat(api): add current-state, history, and worker read endpoints"
```

### Task 15: "As of" reconstruction endpoint

**Files:**
- Create: `apps/api/src/store/store.module.ts`
- Create: `apps/api/src/store/store.service.ts`
- Create: `apps/api/src/store/store.controller.ts`
- Modify: `apps/api/src/app.module.ts` (import `StoreModule`)
- Test: `apps/api/src/store/store.integration.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveMovements`, `replayStoreState`, `RawMovement`, `AssetReplayState` (Task 7); `Movement` model (Task 3).
- Produces: `StoreService.getStoreAsOf(asOf: Date): Promise<Map<string, AssetReplayState>>`; `GET /store?asOf=<ISO>` returning `{ asOf: string; assets: Record<string, AssetReplayState> }` — reused by Task 16's invariant checker (which calls `getStoreAsOf(new Date())` and diffs against live `Asset` documents) and Task 24's e2e test.

- [ ] **Step 1: Write the failing test**

`apps/api/src/store/store.integration.test.ts`:
```ts
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { StoreModule } from './store.module';
import { StoreService } from './store.service';
import { MovementsModule } from '../movements/movements.module';
import { MovementsService } from '../movements/movements.service';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';

describe('StoreService.getStoreAsOf', () => {
  let storeService: StoreService;
  let movementsService: MovementsService;
  let connection: Connection;
  let assetModel: Model<Asset>;
  let workerModel: Model<Worker>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(process.env.MONGO_URI!),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Worker.name, schema: WorkerSchema },
          { name: Movement.name, schema: MovementSchema },
          { name: Reservation.name, schema: ReservationSchema },
        ]),
        MovementsModule,
        StoreModule,
      ],
    }).compile();

    storeService = moduleRef.get(StoreService);
    movementsService = moduleRef.get(MovementsService);
    connection = moduleRef.get(getConnectionToken());
    assetModel = moduleRef.get(getModelToken(Asset.name));
    workerModel = moduleRef.get(getModelToken(Worker.name));
  });

  afterAll(async () => {
    await connection.close();
  });

  it('reconstructs held/free state as of a past instant, and agrees with live Asset state as of now', async () => {
    await assetModel.deleteMany({});
    await workerModel.deleteMany({});
    await workerModel.create({ _id: 'worker-1', name: 'Ana Rios', certifications: [] });
    await assetModel.create({ _id: 'DRILL-STORE-1', kind: 'drill', requiresCertification: null });

    await movementsService.issue({ assetId: 'DRILL-STORE-1', workerId: 'worker-1', occurredAt: '2026-08-01T09:00:00Z', idempotencyKey: 'store-issue-1' });
    await movementsService.return({ assetId: 'DRILL-STORE-1', workerId: 'worker-1', occurredAt: '2026-08-01T17:00:00Z', idempotencyKey: 'store-return-1' });

    const midway = await storeService.getStoreAsOf(new Date('2026-08-01T12:00:00Z'));
    expect(midway.get('DRILL-STORE-1')).toEqual({ status: 'ISSUED', holderId: 'worker-1' });

    const afterReturn = await storeService.getStoreAsOf(new Date('2026-08-01T18:00:00Z'));
    expect(afterReturn.get('DRILL-STORE-1')).toEqual({ status: 'IN_STORE', holderId: null });

    const asOfNow = await storeService.getStoreAsOf(new Date());
    const liveAsset = await assetModel.findById('DRILL-STORE-1').lean();
    expect(asOfNow.get('DRILL-STORE-1')?.status).toBe(liveAsset?.status);
    expect(asOfNow.get('DRILL-STORE-1')?.holderId).toBe(liveAsset?.currentHolderId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest store/store --config jest.config.js`
Expected: FAIL — `Cannot find module './store.module'`.

- [ ] **Step 3: Write `store.service.ts`, `store.module.ts`, `store.controller.ts`**

`apps/api/src/store/store.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Movement } from '../schemas/movement.schema';
import { AssetReplayState, RawMovement, replayStoreState, resolveEffectiveMovements } from '../domain/replay';

@Injectable()
export class StoreService {
  constructor(@InjectModel(Movement.name) private readonly movementModel: Model<Movement>) {}

  async getStoreAsOf(asOf: Date): Promise<Map<string, AssetReplayState>> {
    const docs = await this.movementModel.find({}).lean();
    const raw: RawMovement[] = docs.map((m) => ({
      id: String(m._id),
      assetId: m.assetId,
      workerId: m.workerId,
      type: m.type,
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      correctionOf: m.correctionOf ? String(m.correctionOf) : null,
      correctedBy: m.correctedBy ? String(m.correctedBy) : null,
    }));
    const effective = resolveEffectiveMovements(raw);
    return replayStoreState(effective, asOf);
  }
}
```

`apps/api/src/store/store.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: Movement.name, schema: MovementSchema }])],
  providers: [StoreService],
  controllers: [StoreController],
  exports: [StoreService],
})
export class StoreModule {}
```

`apps/api/src/store/store.controller.ts`:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { StoreService } from './store.service';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Get()
  async getStore(@Query('asOf') asOf?: string) {
    const asOfDate = asOf ? new Date(asOf) : new Date();
    const state = await this.storeService.getStoreAsOf(asOfDate);
    return { asOf: asOfDate.toISOString(), assets: Object.fromEntries(state.entries()) };
  }
}
```

`apps/api/src/app.module.ts` (append `StoreModule`):
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { MovementsModule } from './movements/movements.module';
import { ReservationsModule } from './reservations/reservations.module';
import { AssetsModule } from './assets/assets.module';
import { WorkersModule } from './workers/workers.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [DatabaseModule, MovementsModule, ReservationsModule, AssetsModule, WorkersModule, StoreModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/api`): `npx jest store/store --config jest.config.js`
Expected: PASS — 1 test (three assertions covering midway/after-return/consistency-with-live-state).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/store apps/api/src/app.module.ts
git commit -m "feat(api): add as-of store reconstruction endpoint"
```

---

## Phase 5 — Tooling

### Task 16: Invariant checker

**Files:**
- Create: `apps/api/src/scripts/check-invariants.ts`
- Test: `apps/api/src/scripts/check-invariants.test.ts`

**Interfaces:**
- Consumes: `resolveEffectiveMovements`, `replayStoreState`, `RawMovement` (Task 7); `intervalsOverlap` (Task 6); the five Mongoose schemas (Task 3).
- Produces: `interface InvariantViolation { rule: string; detail: string }`, `checkInvariants(uri: string): Promise<InvariantViolation[]>` (empty array = clean) — used directly by this task's test, and invoked by `main()` for the CLI (`npm run check-invariants -w apps/api`), and reused by Task 17's seed test to assert the freshly seeded store passes clean.

- [ ] **Step 1: Write the failing test**

`apps/api/src/scripts/check-invariants.test.ts`:
```ts
import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { checkInvariants } from './check-invariants';

describe('checkInvariants', () => {
  let conn: mongoose.Connection;
  let AssetModel: mongoose.Model<Asset>;
  let WorkerModel: mongoose.Model<Worker>;
  let MovementModel: mongoose.Model<Movement>;
  let ReservationModel: mongoose.Model<Reservation>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    AssetModel = conn.model(Asset.name, AssetSchema);
    WorkerModel = conn.model(Worker.name, WorkerSchema);
    MovementModel = conn.model(Movement.name, MovementSchema);
    ReservationModel = conn.model(Reservation.name, ReservationSchema);
  });

  afterAll(async () => {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
    ]);
    await conn.close();
  });

  it('reports no violations for an internally consistent store', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'CONSISTENT-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-1' });
    await MovementModel.create({
      assetId: 'CONSISTENT-1',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: new Date('2026-08-01T09:00:00Z'),
      recordedAt: new Date('2026-08-01T09:00:00Z'),
      idempotencyKey: 'inv-ok-1',
    });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations).toHaveLength(0);
  });

  it('reports a violation when live Asset state disagrees with the ledger replay', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    // Deliberately wrong: Asset says ISSUED to worker-2, but no movement ever recorded that.
    await AssetModel.create({ _id: 'MISMATCH-1', kind: 'drill', requiresCertification: null, status: 'ISSUED', currentHolderId: 'worker-2' });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'replay-matches-live-state')).toBe(true);
  });

  it('reports a violation for overlapping ACTIVE reservations on the same asset', async () => {
    await AssetModel.deleteMany({});
    await MovementModel.deleteMany({});
    await ReservationModel.deleteMany({});
    await AssetModel.create({ _id: 'OVERLAP-1', kind: 'drill', requiresCertification: null });
    await ReservationModel.create({ assetId: 'OVERLAP-1', workerId: 'worker-1', startAt: new Date('2027-01-01T09:00Z'), endAt: new Date('2027-01-01T17:00Z'), status: 'ACTIVE', idempotencyKey: 'inv-res-1' });
    await ReservationModel.create({ assetId: 'OVERLAP-1', workerId: 'worker-2', startAt: new Date('2027-01-01T12:00Z'), endAt: new Date('2027-01-01T20:00Z'), status: 'ACTIVE', idempotencyKey: 'inv-res-2' });

    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations.some((v) => v.rule === 'no-overlapping-reservations')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest scripts/check-invariants --config jest.config.js`
Expected: FAIL — `Cannot find module './check-invariants'`.

- [ ] **Step 3: Write `check-invariants.ts`**

```ts
import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { RawMovement, replayStoreState, resolveEffectiveMovements } from '../domain/replay';
import { intervalsOverlap } from '../domain/intervals';

export interface InvariantViolation {
  rule: string;
  detail: string;
}

export async function checkInvariants(uri: string): Promise<InvariantViolation[]> {
  const conn = await mongoose.createConnection(uri).asPromise();
  const AssetModel = conn.model(Asset.name, AssetSchema);
  const MovementModel = conn.model(Movement.name, MovementSchema);
  const ReservationModel = conn.model(Reservation.name, ReservationSchema);

  const violations: InvariantViolation[] = [];

  try {
    const assets = await AssetModel.find({}).lean();
    const movementDocs = await MovementModel.find({}).lean();
    const raw: RawMovement[] = movementDocs.map((m) => ({
      id: String(m._id),
      assetId: m.assetId,
      workerId: m.workerId,
      type: m.type,
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      correctionOf: m.correctionOf ? String(m.correctionOf) : null,
      correctedBy: m.correctedBy ? String(m.correctedBy) : null,
    }));
    const effective = resolveEffectiveMovements(raw);
    const replayed = replayStoreState(effective, new Date());

    // Rule 1: replayed current-state matches every live Asset document exactly.
    for (const asset of assets) {
      const state = replayed.get(asset._id);
      const expectedStatus = state?.status ?? 'IN_STORE';
      const expectedHolder = state?.holderId ?? null;
      if (asset.status !== expectedStatus || asset.currentHolderId !== expectedHolder) {
        violations.push({
          rule: 'replay-matches-live-state',
          detail: `Asset ${asset._id}: live (${asset.status}, holder=${asset.currentHolderId}) != replayed (${expectedStatus}, holder=${expectedHolder})`,
        });
      }
    }

    // Rule 2: no asset ever has two open (unreturned) ISSUE movements at once.
    const byAsset = new Map<string, typeof effective>();
    for (const m of effective) {
      const list = byAsset.get(m.assetId) ?? [];
      list.push(m);
      byAsset.set(m.assetId, list);
    }
    for (const [assetId, moves] of byAsset) {
      const sorted = [...moves].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
      let currentlyIssued = false;
      for (const m of sorted) {
        if (m.type === 'ISSUE') {
          if (currentlyIssued) {
            violations.push({ rule: 'no-double-open-movement', detail: `Asset ${assetId} has two open ISSUE movements around ${m.occurredAt.toISOString()}` });
          }
          currentlyIssued = true;
        } else {
          currentlyIssued = false;
        }
      }
    }

    // Rule 3: no two ACTIVE reservations on the same asset overlap.
    const activeReservations = await ReservationModel.find({ status: 'ACTIVE' }).lean();
    const byAssetRes = new Map<string, typeof activeReservations>();
    for (const r of activeReservations) {
      const list = byAssetRes.get(r.assetId) ?? [];
      list.push(r);
      byAssetRes.set(r.assetId, list);
    }
    for (const [assetId, reservations] of byAssetRes) {
      for (let i = 0; i < reservations.length; i++) {
        for (let j = i + 1; j < reservations.length; j++) {
          if (intervalsOverlap(reservations[i].startAt, reservations[i].endAt, reservations[j].startAt, reservations[j].endAt)) {
            violations.push({
              rule: 'no-overlapping-reservations',
              detail: `Asset ${assetId} has overlapping reservations ${reservations[i]._id} and ${reservations[j]._id}`,
            });
          }
        }
      }
    }

    // Rule 4: every correction references a real, once-only-corrected original, bidirectionally consistent.
    const movementById = new Map(movementDocs.map((m) => [String(m._id), m]));
    const correctionOfCounts = new Map<string, number>();
    for (const m of movementDocs) {
      if (m.correctionOf) {
        const key = String(m.correctionOf);
        correctionOfCounts.set(key, (correctionOfCounts.get(key) ?? 0) + 1);
        const original = movementById.get(key);
        if (!original) {
          violations.push({ rule: 'correction-integrity', detail: `Movement ${m._id} corrects a nonexistent movement ${key}` });
        } else if (String(original.correctedBy) !== String(m._id)) {
          violations.push({ rule: 'correction-integrity', detail: `Original movement ${key} correctedBy does not point back to its correction ${m._id}` });
        }
      }
    }
    for (const [originalId, count] of correctionOfCounts) {
      if (count > 1) {
        violations.push({ rule: 'correction-integrity', detail: `Movement ${originalId} has been corrected more than once` });
      }
    }

    return violations;
  } finally {
    await conn.close();
  }
}

async function main() {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0';
  const violations = await checkInvariants(uri);
  if (violations.length === 0) {
    console.log('OK: no invariant violations found.');
    process.exit(0);
  }
  console.error(`FAILED: ${violations.length} invariant violation(s) found:`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.detail}`);
  process.exit(1);
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/api`): `npx jest scripts/check-invariants --config jest.config.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/check-invariants.ts apps/api/src/scripts/check-invariants.test.ts
git commit -m "feat(api): add standalone invariant-checker script"
```

### Task 17: Seed script

**Files:**
- Create: `apps/api/src/scripts/seed.ts`
- Test: `apps/api/src/scripts/seed.test.ts`

**Interfaces:**
- Consumes: the five Mongoose schemas (Task 3), `checkInvariants` (Task 16).
- Produces: `export async function seed(uri: string, now?: Date): Promise<{ assetCount: number; workerCount: number; movementCount: number; reservationCount: number; outOfServiceAssetId: string }>` (the `now` parameter lets the test pin "now" for reproducible assertions; the CLI's `main()` omits it, defaulting to the real current time) plus a CLI entry point (`npm run seed -w apps/api`).

- [ ] **Step 1: Write the failing test**

`apps/api/src/scripts/seed.test.ts`:
```ts
import mongoose from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { seed } from './seed';
import { checkInvariants } from './check-invariants';

describe('seed', () => {
  let conn: mongoose.Connection;
  let AssetModel: mongoose.Model<Asset>;
  let WorkerModel: mongoose.Model<Worker>;
  let MovementModel: mongoose.Model<Movement>;
  let ReservationModel: mongoose.Model<Reservation>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(process.env.MONGO_URI!).asPromise();
    AssetModel = conn.model(Asset.name, AssetSchema);
    WorkerModel = conn.model(Worker.name, WorkerSchema);
    MovementModel = conn.model(Movement.name, MovementSchema);
    ReservationModel = conn.model(Reservation.name, ReservationSchema);
  });

  afterAll(async () => {
    await conn.close();
  });

  it('produces the same story on a second run (deterministic, repeat-safe)', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');

    const first = await seed(process.env.MONGO_URI!, fixedNow);
    const firstAssetCount = await AssetModel.countDocuments();
    const firstWorkerCount = await WorkerModel.countDocuments();

    const second = await seed(process.env.MONGO_URI!, fixedNow);
    const secondAssetCount = await AssetModel.countDocuments();
    const secondWorkerCount = await WorkerModel.countDocuments();

    expect(secondAssetCount).toBe(firstAssetCount);
    expect(secondWorkerCount).toBe(firstWorkerCount);
    expect(second.outOfServiceAssetId).toBe(first.outOfServiceAssetId);
    expect(second.assetCount).toBe(60);
    expect(second.workerCount).toBe(12);
  });

  it('produces the required scenario shapes: certifications, out-of-service, movements, reservations', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);

    const outOfServiceCount = await AssetModel.countDocuments({ status: 'OUT_OF_SERVICE' });
    expect(outOfServiceCount).toBeGreaterThanOrEqual(1);

    const expiredCerts = await WorkerModel.countDocuments({ 'certifications.expiresAt': { $lt: fixedNow } });
    expect(expiredCerts).toBeGreaterThanOrEqual(2);

    const openIssues = await AssetModel.countDocuments({ status: 'ISSUED' });
    expect(openIssues).toBeGreaterThanOrEqual(1);

    const correctionCount = await MovementModel.countDocuments({ correctionOf: { $ne: null } });
    expect(correctionCount).toBeGreaterThanOrEqual(1);

    const lateLogged = await MovementModel.countDocuments({ $expr: { $gt: [{ $subtract: ['$recordedAt', '$occurredAt'] }, 60 * 60 * 1000] } });
    expect(lateLogged).toBeGreaterThanOrEqual(1);

    const activeReservations = await ReservationModel.countDocuments({ status: 'ACTIVE' });
    expect(activeReservations).toBeGreaterThanOrEqual(2);
  });

  it('passes the invariant checker immediately after seeding', async () => {
    const fixedNow = new Date('2026-09-08T12:00:00Z');
    await seed(process.env.MONGO_URI!, fixedNow);
    const violations = await checkInvariants(process.env.MONGO_URI!);
    expect(violations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/api`): `npx jest scripts/seed --config jest.config.js`
Expected: FAIL — `Cannot find module './seed'`.

- [ ] **Step 3: Write `seed.ts`**

```ts
import mongoose, { Types } from 'mongoose';
import { Asset, AssetSchema } from '../schemas/asset.schema';
import { Worker, WorkerSchema } from '../schemas/worker.schema';
import { Movement, MovementSchema } from '../schemas/movement.schema';
import { Reservation, ReservationSchema } from '../schemas/reservation.schema';
import { AssetLock, AssetLockSchema } from '../schemas/asset-lock.schema';

const SEED = 1337;
const DAY_MS = 24 * 60 * 60 * 1000;
const ASSET_COUNT = 60;
const WINDOW_DAYS = 30;

function mulberry32(seed: number) {
  let s = seed;
  return function random() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ASSET_KINDS = [
  { kind: 'drill', prefix: 'DRILL', requiresCertification: null as string | null },
  { kind: 'grinder', prefix: 'GRIND', requiresCertification: null as string | null },
  { kind: 'ladder', prefix: 'LADR', requiresCertification: null as string | null },
  { kind: 'generator', prefix: 'GEN', requiresCertification: null as string | null },
  { kind: 'harness', prefix: 'HARN', requiresCertification: 'HEIGHTS' },
  { kind: 'gas-detector', prefix: 'GASD', requiresCertification: 'GAS-DETECT' },
];

const WORKER_NAMES = [
  'Ana Rios', 'Ben Cole', 'Chidi Okoye', 'Dana Kim', 'Elif Sari', 'Farid Hassan',
  'Grace Lin', 'Hugo Alves', 'Ines Duarte', 'Jamal Reed', 'Kira Novak', 'Liu Wei',
];

function slugify(name: string): string {
  return 'worker-' + name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildAssets() {
  const assets: { _id: string; kind: string; requiresCertification: string | null }[] = [];
  for (let i = 0; i < ASSET_COUNT; i++) {
    const kindDef = ASSET_KINDS[i % ASSET_KINDS.length];
    const code = `${kindDef.prefix}-${String(i + 1).padStart(3, '0')}`;
    assets.push({ _id: code, kind: kindDef.kind, requiresCertification: kindDef.requiresCertification });
  }
  return assets;
}

function buildWorkers(now: Date) {
  const longExpired = new Date(now.getTime() - 60 * DAY_MS);
  const expiredInWindow = new Date(now.getTime() - 15 * DAY_MS);
  const farFuture = new Date(now.getTime() + 365 * DAY_MS);

  return WORKER_NAMES.map((name, i) => {
    let certifications: { code: string; expiresAt: Date }[];
    if (i === 0) certifications = [{ code: 'GAS-DETECT', expiresAt: longExpired }];
    else if (i === 1) certifications = [{ code: 'HEIGHTS', expiresAt: expiredInWindow }];
    else if (i % 2 === 0) certifications = [{ code: 'HEIGHTS', expiresAt: farFuture }];
    else certifications = [{ code: 'GAS-DETECT', expiresAt: farFuture }];
    return { _id: slugify(name), name, certifications };
  });
}

interface SeedMovement {
  _id: Types.ObjectId;
  assetId: string;
  workerId: string | null;
  type: string;
  occurredAt: Date;
  recordedAt: Date;
  idempotencyKey: string;
  correctionOf: Types.ObjectId | null;
  correctedBy: Types.ObjectId | null;
  reason: string | null;
}

interface AssetPatch {
  status: string;
  currentHolderId: string | null;
  currentMovementId: string | null;
}

function buildMovementsAndPatches(
  assets: ReturnType<typeof buildAssets>,
  workers: ReturnType<typeof buildWorkers>,
  now: Date,
  rng: () => number,
) {
  const movements: SeedMovement[] = [];
  const patches = new Map<string, AssetPatch>();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

  const outOfServiceAssetId = assets[5]._id; // GASD-006
  const overdueAssetId = assets[0]._id; // DRILL-001
  const lateLoggedAssetId = assets[1]._id; // GRIND-002
  const correctedAssetId = assets[2]._id; // LADR-003

  const eligibleWorkersFor = (requiresCertification: string | null) =>
    requiresCertification === null
      ? workers
      : workers.filter((w) => w.certifications.some((c) => c.code === requiresCertification && c.expiresAt.getTime() > now.getTime()));

  const pickWorker = (requiresCertification: string | null) => {
    const pool = eligibleWorkersFor(requiresCertification);
    const from = pool.length > 0 ? pool : workers;
    return from[Math.floor(rng() * from.length)];
  };

  for (const asset of assets) {
    if (asset._id === outOfServiceAssetId) {
      const occurredAt = new Date(windowStart.getTime() + 2 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: null,
        type: 'OUT_OF_SERVICE',
        occurredAt,
        recordedAt: occurredAt,
        idempotencyKey: `seed-oos-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: 'Seeded as damaged',
      });
      patches.set(asset._id, { status: 'OUT_OF_SERVICE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    if (asset._id === overdueAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const occurredAt = new Date(now.getTime() - 10 * DAY_MS);
      const id = new Types.ObjectId();
      movements.push({
        _id: id,
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt,
        recordedAt: occurredAt,
        idempotencyKey: `seed-issue-overdue-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'ISSUED', currentHolderId: worker._id, currentMovementId: String(id) });
      continue;
    }

    if (asset._id === lateLoggedAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const issueOccurredAt = new Date(windowStart.getTime() + 5 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      const returnOccurredAt = new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000);
      const returnRecordedAt = new Date(returnOccurredAt.getTime() + 2 * 60 * 60 * 1000 + 40 * 60 * 1000);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: returnOccurredAt,
        recordedAt: returnRecordedAt,
        idempotencyKey: `seed-return-late-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    if (asset._id === correctedAssetId) {
      const worker = pickWorker(asset.requiresCertification);
      const issueOccurredAt = new Date(windowStart.getTime() + 3 * DAY_MS);
      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      const wrongReturnId = new Types.ObjectId();
      const correctionId = new Types.ObjectId();
      const wrongReturnOccurredAt = new Date(issueOccurredAt.getTime() + 8 * 60 * 60 * 1000);
      movements.push({
        _id: wrongReturnId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: wrongReturnOccurredAt,
        recordedAt: wrongReturnOccurredAt,
        idempotencyKey: `seed-return-corrected-${asset._id}`,
        correctionOf: null,
        correctedBy: correctionId,
        reason: null,
      });
      movements.push({
        _id: correctionId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: new Date(wrongReturnOccurredAt.getTime() + 60 * 60 * 1000),
        recordedAt: new Date(now.getTime() - 1 * DAY_MS),
        idempotencyKey: `seed-correction-${asset._id}`,
        correctionOf: wrongReturnId,
        correctedBy: null,
        reason: 'Keeper logged the wrong return time',
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      continue;
    }

    // Ordinary traffic: 1-3 issue/return pairs across the window; ~15% of assets end up still outstanding.
    const pairCount = 1 + Math.floor(rng() * 3);
    let cursor = windowStart;
    const leaveOutstanding = rng() < 0.15;
    let settled = false;

    for (let p = 0; p < pairCount && !settled; p++) {
      const issueOccurredAt = new Date(cursor.getTime() + rng() * 2 * DAY_MS);
      if (issueOccurredAt.getTime() >= now.getTime()) break;

      const worker = pickWorker(asset.requiresCertification);
      const issueId = new Types.ObjectId();
      movements.push({
        _id: issueId,
        assetId: asset._id,
        workerId: worker._id,
        type: 'ISSUE',
        occurredAt: issueOccurredAt,
        recordedAt: issueOccurredAt,
        idempotencyKey: `seed-issue-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });

      const isLastPair = p === pairCount - 1;
      const returnOccurredAt = new Date(issueOccurredAt.getTime() + (2 + rng() * 6) * 60 * 60 * 1000);

      if ((isLastPair && leaveOutstanding) || returnOccurredAt.getTime() >= now.getTime()) {
        patches.set(asset._id, { status: 'ISSUED', currentHolderId: worker._id, currentMovementId: String(issueId) });
        settled = true;
        break;
      }

      movements.push({
        _id: new Types.ObjectId(),
        assetId: asset._id,
        workerId: worker._id,
        type: 'RETURN',
        occurredAt: returnOccurredAt,
        recordedAt: returnOccurredAt,
        idempotencyKey: `seed-return-${asset._id}-${p}`,
        correctionOf: null,
        correctedBy: null,
        reason: null,
      });
      patches.set(asset._id, { status: 'IN_STORE', currentHolderId: null, currentMovementId: null });
      cursor = returnOccurredAt;
    }
  }

  return { movements, patches, outOfServiceAssetId };
}

function buildReservations(assets: ReturnType<typeof buildAssets>, workers: ReturnType<typeof buildWorkers>, now: Date, outOfServiceAssetId: string) {
  const reservable = assets.filter((a) => a._id !== outOfServiceAssetId);
  const neverCollectedAsset = reservable[reservable.length - 1];
  const pastActiveAsset = reservable[reservable.length - 2];

  const futureStart = new Date(now.getTime() + 5 * DAY_MS);
  const futureEnd = new Date(futureStart.getTime() + 8 * 60 * 60 * 1000);
  const pastStart = new Date(now.getTime() - 20 * DAY_MS);
  const pastEnd = new Date(pastStart.getTime() + 8 * 60 * 60 * 1000);

  return [
    {
      assetId: neverCollectedAsset._id,
      workerId: workers[2]._id,
      startAt: futureStart,
      endAt: futureEnd,
      status: 'ACTIVE',
      idempotencyKey: `seed-reservation-future-${neverCollectedAsset._id}`,
    },
    {
      assetId: pastActiveAsset._id,
      workerId: workers[3]._id,
      startAt: pastStart,
      endAt: pastEnd,
      status: 'ACTIVE',
      idempotencyKey: `seed-reservation-past-${pastActiveAsset._id}`,
    },
  ];
}

export async function seed(uri: string, now: Date = new Date()) {
  const conn = await mongoose.createConnection(uri).asPromise();
  const AssetModel = conn.model(Asset.name, AssetSchema);
  const WorkerModel = conn.model(Worker.name, WorkerSchema);
  const MovementModel = conn.model(Movement.name, MovementSchema);
  const ReservationModel = conn.model(Reservation.name, ReservationSchema);
  const AssetLockModel = conn.model(AssetLock.name, AssetLockSchema);

  try {
    await Promise.all([
      AssetModel.deleteMany({}),
      WorkerModel.deleteMany({}),
      MovementModel.deleteMany({}),
      ReservationModel.deleteMany({}),
      AssetLockModel.deleteMany({}),
    ]);

    const rng = mulberry32(SEED);
    const assets = buildAssets();
    const workers = buildWorkers(now);
    const { movements, patches, outOfServiceAssetId } = buildMovementsAndPatches(assets, workers, now, rng);
    const reservations = buildReservations(assets, workers, now, outOfServiceAssetId);

    await WorkerModel.insertMany(workers);

    const assetDocs = assets.map((a) => {
      const patch = patches.get(a._id);
      return {
        _id: a._id,
        kind: a.kind,
        requiresCertification: a.requiresCertification,
        status: patch?.status ?? 'IN_STORE',
        currentHolderId: patch?.currentHolderId ?? null,
        currentMovementId: patch?.currentMovementId ?? null,
        updatedAt: now,
      };
    });
    await AssetModel.insertMany(assetDocs);

    if (movements.length > 0) await MovementModel.insertMany(movements);
    if (reservations.length > 0) await ReservationModel.insertMany(reservations);

    return {
      assetCount: assetDocs.length,
      workerCount: workers.length,
      movementCount: movements.length,
      reservationCount: reservations.length,
      outOfServiceAssetId,
    };
  } finally {
    await conn.close();
  }
}

async function main() {
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/equipment_ledger?replicaSet=rs0';
  const result = await seed(uri);
  console.log(`Seeded ${result.assetCount} assets, ${result.workerCount} workers, ${result.movementCount} movements, ${result.reservationCount} reservations.`);
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/api`): `npx jest scripts/seed --config jest.config.js`
Expected: PASS — 3 tests (determinism, scenario shapes, clean invariant check).

- [ ] **Step 5: Seed the dev database and commit**

Run: `npm run seed -w apps/api` (against the default dev `MONGO_URI`)

```bash
git add apps/api/src/scripts/seed.ts apps/api/src/scripts/seed.test.ts
git commit -m "feat(api): add deterministic, repeat-safe seed script"
```

---

## Phase 6 — Frontend

A note on scope for this phase: the components below are functionally complete and semantically clean (real Tailwind utility classes, no inline pixel-pushing), but the visual language itself (color system, spacing rhythm, type scale) gets a dedicated design pass live during execution rather than being pinned upfront here — keep markup semantic so that pass is a styling change, not a restructuring.

### Task 18: Next.js scaffold — API client and keeper gate

**Files:**
- Create: `apps/web/jest.config.js`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/keepers.ts`
- Create: `apps/web/src/components/KeeperGate.tsx`
- Modify: `apps/web/src/app/layout.tsx` (wrap children in `KeeperGate`)
- Test: `apps/web/src/components/KeeperGate.test.tsx`
- Modify: `apps/web/package.json` (add `@testing-library/dom` as a transitive-safe devDependency if not already pulled in by `@testing-library/react`; it is, so no change needed beyond what Task 1 already listed)

**Interfaces:**
- Consumes: nothing beyond the browser `fetch`/`localStorage` APIs.
- Produces: `apiFetch<T>(path: string, options?: RequestInit): Promise<T>` and `newIdempotencyKey(): string` from `apps/web/src/lib/api.ts` — used by every later frontend task that calls the API. `KEEPERS: string[]` from `apps/web/src/lib/keepers.ts`. `<KeeperGate>` component gating `children` behind a picked keeper name, persisted under `localStorage` key `equipment-ledger:keeper`.

- [ ] **Step 1: Write `apps/web/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  globals: {
    'ts-jest': {
      tsconfig: { jsx: 'react-jsx' },
    },
  },
};
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/components/KeeperGate.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeeperGate } from './KeeperGate';

describe('KeeperGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the keeper list and gates children until one is picked', () => {
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Patel')).toBeInTheDocument();
  });

  it('persists the selection to localStorage and reveals children', () => {
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    fireEvent.click(screen.getByText('Priya Patel'));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(window.localStorage.getItem('equipment-ledger:keeper')).toBe('Priya Patel');
  });

  it('reads a previously persisted keeper on mount, skipping the picker', () => {
    window.localStorage.setItem('equipment-ledger:keeper', 'Marcus Webb');
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `apps/web`): `npx jest KeeperGate --config jest.config.js`
Expected: FAIL — `Cannot find module './KeeperGate'`.

- [ ] **Step 4: Write `keepers.ts`, `api.ts`, and `KeeperGate.tsx`**

`apps/web/src/lib/keepers.ts`:
```ts
export const KEEPERS = ['Priya Patel', 'Marcus Webb', 'Sofia Ibarra'];
```

`apps/web/src/lib/api.ts`:
```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
```

`apps/web/src/components/KeeperGate.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { KEEPERS } from '../lib/keepers';

const STORAGE_KEY = 'equipment-ledger:keeper';

export function KeeperGate({ children }: { children: React.ReactNode }) {
  const [keeper, setKeeper] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setKeeper(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      setKeeper(null);
    }
    setHydrated(true);
  }, []);

  const selectKeeper = (name: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Storage may be unavailable (private browsing); the session still gates via component state.
    }
    setKeeper(name);
  };

  if (!hydrated) return null;

  if (!keeper) {
    return (
      <div className="p-8 max-w-md mx-auto">
        <h1 className="text-xl font-semibold mb-4">Who&apos;s on the hatch?</h1>
        <ul className="space-y-2">
          {KEEPERS.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="w-full text-left px-4 py-2 border rounded hover:bg-gray-50"
                onClick={() => selectKeeper(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return <>{children}</>;
}
```

`apps/web/src/app/layout.tsx` (replace body content with the gate):
```tsx
import './globals.css';
import { KeeperGate } from '../components/KeeperGate';

export const metadata = { title: 'Equipment Ledger' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KeeperGate>{children}</KeeperGate>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `apps/web`): `npx jest KeeperGate --config jest.config.js`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/jest.config.js apps/web/src/lib apps/web/src/components apps/web/src/app/layout.tsx
git commit -m "feat(web): add API client and keeper gate"
```

### Task 19: Dashboard, shared StoreGrid, and the idempotent Issue/Return modal

**Files:**
- Create: `apps/web/src/components/StoreGrid.tsx`
- Create: `apps/web/src/components/IssueReturnModal.tsx`
- Create: `apps/web/src/app/DashboardClient.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Test: `apps/web/src/components/IssueReturnModal.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `newIdempotencyKey` (Task 18).
- Produces: `AssetSummary` (frontend-local type mirroring the API's `GET /assets` JSON response — deliberately not shared with the backend's internal `AssetSummary` type from Task 14, since it's a wire-format contract, not a code dependency), exported from `StoreGrid.tsx` and reused by Task 20's asset detail page and Task 23's history page; `<StoreGrid assets={...} onIssue={...} onReturn={...} />`; `<IssueReturnModal asset={...} action={'issue'|'return'} onClose={...} />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/IssueReturnModal.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueReturnModal } from './IssueReturnModal';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
}));

const asset = {
  _id: 'DRILL-001',
  kind: 'drill',
  requiresCertification: null,
  status: 'IN_STORE' as const,
  currentHolderId: null,
  upcomingReservation: null,
};

describe('IssueReturnModal idempotency key', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('reuses the same idempotency key across a retry after a failed submit', async () => {
    (apiFetch as jest.Mock).mockRejectedValueOnce(new Error('network blip')).mockResolvedValueOnce({});

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it('generates a new idempotency key for a new modal instance', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});

    const { unmount } = render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;
    unmount();

    render(<IssueReturnModal asset={asset} action="issue" onClose={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-2' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx jest IssueReturnModal --config jest.config.js`
Expected: FAIL — `Cannot find module './IssueReturnModal'`.

- [ ] **Step 3: Write `StoreGrid.tsx`, `IssueReturnModal.tsx`, `DashboardClient.tsx`, and update `page.tsx`**

`apps/web/src/components/StoreGrid.tsx`:
```tsx
export interface AssetSummary {
  _id: string;
  kind: string;
  requiresCertification: string | null;
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  currentHolderId: string | null;
  upcomingReservation: { startAt: string; endAt: string; workerId: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  IN_STORE: 'bg-green-100 text-green-800',
  ISSUED: 'bg-blue-100 text-blue-800',
  OUT_OF_SERVICE: 'bg-red-100 text-red-800',
};

export function StoreGrid({
  assets,
  onIssue,
  onReturn,
}: {
  assets: AssetSummary[];
  onIssue?: (asset: AssetSummary) => void;
  onReturn?: (asset: AssetSummary) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {assets.map((asset) => (
        <div key={asset._id} className="border rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-mono text-sm text-gray-500">{asset._id}</div>
              <div className="font-medium">{asset.kind}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[asset.status]}`}>{asset.status}</span>
          </div>
          {asset.currentHolderId && <div className="text-sm text-gray-600 mt-2">Held by {asset.currentHolderId}</div>}
          {(onIssue || onReturn) && (
            <div className="mt-3 flex gap-2">
              {onIssue && asset.status === 'IN_STORE' && (
                <button type="button" onClick={() => onIssue(asset)} className="text-sm px-3 py-1 border rounded">
                  Issue
                </button>
              )}
              {onReturn && asset.status === 'ISSUED' && (
                <button type="button" onClick={() => onReturn(asset)} className="text-sm px-3 py-1 border rounded">
                  Return
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

`apps/web/src/components/IssueReturnModal.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { apiFetch, newIdempotencyKey } from '../lib/api';
import { AssetSummary } from './StoreGrid';

export function IssueReturnModal({
  asset,
  action,
  onClose,
}: {
  asset: AssetSummary;
  action: 'issue' | 'return';
  onClose: () => void;
}) {
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [asset._id, action]);
  const [workerId, setWorkerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const path = action === 'issue' ? '/movements/issue' : '/movements/return';
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ assetId: asset._id, workerId, idempotencyKey }),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg p-6 w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-4">
          {action === 'issue' ? 'Issue' : 'Return'} {asset._id}
        </h2>
        <input
          type="text"
          placeholder="Worker ID"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="border rounded px-3 py-2 w-full mb-3"
          disabled={submitting}
        />
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="px-3 py-1 border rounded">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !workerId}
            className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
```

`apps/web/src/app/DashboardClient.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetSummary, StoreGrid } from '../components/StoreGrid';
import { IssueReturnModal } from '../components/IssueReturnModal';

export function DashboardClient({ assets }: { assets: AssetSummary[] }) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ asset: AssetSummary; action: 'issue' | 'return' } | null>(null);

  const kinds = useMemo(() => Array.from(new Set(assets.map((a) => a.kind))), [assets]);

  const filtered = useMemo(
    () =>
      assets.filter((a) => {
        if (kindFilter && a.kind !== kindFilter) return false;
        if (statusFilter && a.status !== statusFilter) return false;
        if (search && !a._id.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [assets, kindFilter, statusFilter, search],
  );

  const closeModal = () => {
    setModal(null);
    router.refresh();
  };

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Equipment Ledger</h1>
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="border rounded px-3 py-2">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-3 py-2">
          <option value="">All statuses</option>
          <option value="IN_STORE">In store</option>
          <option value="ISSUED">Issued</option>
          <option value="OUT_OF_SERVICE">Out of service</option>
        </select>
      </div>
      <StoreGrid
        assets={filtered}
        onIssue={(asset) => setModal({ asset, action: 'issue' })}
        onReturn={(asset) => setModal({ asset, action: 'return' })}
      />
      {modal && <IssueReturnModal asset={modal.asset} action={modal.action} onClose={closeModal} />}
    </main>
  );
}
```

`apps/web/src/app/page.tsx`:
```tsx
import { DashboardClient } from './DashboardClient';
import { AssetSummary } from '../components/StoreGrid';

async function fetchAssets(): Promise<AssetSummary[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/assets`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load assets');
  return res.json();
}

export default async function HomePage() {
  const assets = await fetchAssets();
  return <DashboardClient assets={assets} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx jest IssueReturnModal --config jest.config.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(web): add dashboard, shared store grid, and idempotent issue/return modal"
```

### Task 20: Asset detail page with history timeline and corrections

**Files:**
- Create: `apps/web/src/lib/types.ts`
- Create: `apps/web/src/components/HistoryTimeline.tsx`
- Create: `apps/web/src/components/CorrectMovementForm.tsx`
- Create: `apps/web/src/app/assets/[id]/page.tsx`
- Create: `apps/web/src/app/assets/[id]/AssetDetailClient.tsx`
- Test: `apps/web/src/components/HistoryTimeline.test.tsx`

**Interfaces:**
- Consumes: `AssetSummary` (Task 19), `apiFetch`/`newIdempotencyKey` (Task 18).
- Produces: `MovementView`, `HistoryEntryView` from `apps/web/src/lib/types.ts`; `<HistoryTimeline entries={...} onCorrected={...} />` — reused as-is (no changes needed) by any later page that shows a movement list.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/HistoryTimeline.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { HistoryTimeline } from './HistoryTimeline';
import { HistoryEntryView } from '../lib/types';

const baseMovement = {
  _id: 'm1',
  assetId: 'DRILL-001',
  workerId: 'worker-1',
  type: 'RETURN' as const,
  occurredAt: '2026-08-01T09:00:00.000Z',
  recordedAt: '2026-08-01T09:00:00.000Z',
  reason: null,
};

describe('HistoryTimeline', () => {
  it('renders a corrected entry with its correction inline and no "Correct this entry" action', () => {
    const entries: HistoryEntryView[] = [
      {
        movement: baseMovement,
        correction: { ...baseMovement, _id: 'm2', occurredAt: '2026-08-01T11:00:00.000Z', reason: 'Logged the wrong time' },
      },
    ];
    render(<HistoryTimeline entries={entries} onCorrected={jest.fn()} />);
    expect(screen.getByText('Corrected')).toBeInTheDocument();
    expect(screen.getByText('Logged the wrong time')).toBeInTheDocument();
    expect(screen.queryByText('Correct this entry')).not.toBeInTheDocument();
  });

  it('renders an uncorrected entry with a "Correct this entry" action', () => {
    const entries: HistoryEntryView[] = [{ movement: baseMovement, correction: null }];
    render(<HistoryTimeline entries={entries} onCorrected={jest.fn()} />);
    expect(screen.getByText('Correct this entry')).toBeInTheDocument();
    expect(screen.queryByText('Corrected')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx jest HistoryTimeline --config jest.config.js`
Expected: FAIL — `Cannot find module './HistoryTimeline'`.

- [ ] **Step 3: Write `types.ts`, `CorrectMovementForm.tsx`, `HistoryTimeline.tsx`, the detail page, and its client component**

`apps/web/src/lib/types.ts`:
```ts
export interface MovementView {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: 'ISSUE' | 'RETURN' | 'OUT_OF_SERVICE' | 'BACK_IN_SERVICE';
  occurredAt: string;
  recordedAt: string;
  reason: string | null;
}

export interface HistoryEntryView {
  movement: MovementView;
  correction: MovementView | null;
}
```

`apps/web/src/components/CorrectMovementForm.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { apiFetch, newIdempotencyKey } from '../lib/api';

export function CorrectMovementForm({ movementId, onDone }: { movementId: string; onDone: () => void }) {
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [movementId]);
  const [occurredAt, setOccurredAt] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/movements/${movementId}/correct`, {
        method: 'POST',
        body: JSON.stringify({
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          reason: reason || undefined,
          idempotencyKey,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      <label className="block text-sm mb-1">Corrected time</label>
      <input
        type="datetime-local"
        value={occurredAt}
        onChange={(e) => setOccurredAt(e.target.value)}
        className="border rounded px-2 py-1 mb-2 w-full"
        disabled={submitting}
      />
      <label className="block text-sm mb-1">Reason</label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border rounded px-2 py-1 mb-2 w-full"
        disabled={submitting}
      />
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || !occurredAt}
        className="text-sm px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
      >
        Save correction
      </button>
    </div>
  );
}
```

`apps/web/src/components/HistoryTimeline.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { CorrectMovementForm } from './CorrectMovementForm';
import { HistoryEntryView } from '../lib/types';

export function HistoryTimeline({ entries, onCorrected }: { entries: HistoryEntryView[]; onCorrected: () => void }) {
  const [correctingId, setCorrectingId] = useState<string | null>(null);

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.movement._id} className="border rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">{entry.movement.type}</div>
              <div className="text-sm text-gray-500">occurred {new Date(entry.movement.occurredAt).toLocaleString()}</div>
            </div>
            {!entry.correction && (
              <button type="button" onClick={() => setCorrectingId(entry.movement._id)} className="text-sm px-2 py-1 border rounded">
                Correct this entry
              </button>
            )}
          </div>
          {entry.correction && (
            <div className="mt-2 pl-4 border-l-2 border-amber-400 text-sm">
              <div className="text-amber-700 font-medium">Corrected</div>
              <div>now recorded as occurring {new Date(entry.correction.occurredAt).toLocaleString()}</div>
              {entry.correction.reason && <div className="text-gray-500">{entry.correction.reason}</div>}
            </div>
          )}
          {correctingId === entry.movement._id && (
            <CorrectMovementForm
              movementId={entry.movement._id}
              onDone={() => {
                setCorrectingId(null);
                onCorrected();
              }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
```

`apps/web/src/app/assets/[id]/AssetDetailClient.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryTimeline } from '../../../components/HistoryTimeline';
import { IssueReturnModal } from '../../../components/IssueReturnModal';
import { HistoryEntryView } from '../../../lib/types';

export function AssetDetailClient({ asset, history }: { asset: AssetSummary; history: HistoryEntryView[] }) {
  const router = useRouter();
  const [modalAction, setModalAction] = useState<'issue' | 'return' | null>(null);

  const refresh = () => router.refresh();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">{asset._id}</h1>
      <p className="text-gray-500 mb-6">
        {asset.kind} — {asset.status}
      </p>
      <div className="flex gap-2 mb-8">
        {asset.status === 'IN_STORE' && (
          <button type="button" onClick={() => setModalAction('issue')} className="px-3 py-1 border rounded">
            Issue
          </button>
        )}
        {asset.status === 'ISSUED' && (
          <button type="button" onClick={() => setModalAction('return')} className="px-3 py-1 border rounded">
            Return
          </button>
        )}
      </div>
      <h2 className="text-lg font-semibold mb-3">History</h2>
      <HistoryTimeline entries={history} onCorrected={refresh} />
      {modalAction && (
        <IssueReturnModal
          asset={asset}
          action={modalAction}
          onClose={() => {
            setModalAction(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
```

`apps/web/src/app/assets/[id]/page.tsx`:
```tsx
import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryEntryView } from '../../../lib/types';
import { AssetDetailClient } from './AssetDetailClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchAsset(id: string): Promise<AssetSummary> {
  const res = await fetch(`${API_URL}/assets/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load asset');
  return res.json();
}

async function fetchHistory(id: string): Promise<HistoryEntryView[]> {
  const res = await fetch(`${API_URL}/assets/${id}/history`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load history');
  return res.json();
}

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const [asset, history] = await Promise.all([fetchAsset(params.id), fetchHistory(params.id)]);
  return <AssetDetailClient asset={asset} history={history} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx jest HistoryTimeline --config jest.config.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/components/HistoryTimeline.tsx apps/web/src/components/HistoryTimeline.test.tsx apps/web/src/components/CorrectMovementForm.tsx apps/web/src/app/assets
git commit -m "feat(web): add asset detail page with history timeline and corrections"
```

### Task 21: Worker pages

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add `CertificationView`, `WorkerSummaryView`, `WorkerDetailView`, `ReservationView`)
- Create: `apps/web/src/components/CertificationList.tsx`
- Create: `apps/web/src/app/workers/page.tsx`
- Create: `apps/web/src/app/workers/[id]/page.tsx`
- Test: `apps/web/src/components/CertificationList.test.tsx`

**Interfaces:**
- Consumes: `StoreGrid`/`AssetSummary` (Task 19).
- Produces: `<CertificationList certifications={...} />`; `ReservationView` type reused by Task 22's reservations page.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/CertificationList.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CertificationList } from './CertificationList';

describe('CertificationList', () => {
  it('flags a certification whose expiresAt is in the past as Expired', () => {
    render(<CertificationList certifications={[{ code: 'GAS-DETECT', expiresAt: '2020-01-01T00:00:00.000Z' }]} />);
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
  });

  it('does not flag a certification whose expiresAt is in the future', () => {
    render(<CertificationList certifications={[{ code: 'HEIGHTS', expiresAt: '2099-01-01T00:00:00.000Z' }]} />);
    expect(screen.queryByText(/Expired/)).not.toBeInTheDocument();
    expect(screen.getByText(/Valid/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx jest CertificationList --config jest.config.js`
Expected: FAIL — `Cannot find module './CertificationList'`.

- [ ] **Step 3: Add the types and write the component and pages**

Add to `apps/web/src/lib/types.ts`:
```ts
export interface CertificationView {
  code: string;
  expiresAt: string;
}

export interface WorkerSummaryView {
  _id: string;
  name: string;
  certifications: CertificationView[];
}

export interface ReservationView {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: string;
  endAt: string;
  status: 'ACTIVE' | 'CANCELLED' | 'FULFILLED' | 'EXPIRED';
}

export interface WorkerDetailView extends WorkerSummaryView {
  currentlyHolding: import('../components/StoreGrid').AssetSummary[];
  reservations: ReservationView[];
}
```

`apps/web/src/components/CertificationList.tsx`:
```tsx
import { CertificationView } from '../lib/types';

export function CertificationList({ certifications }: { certifications: CertificationView[] }) {
  const now = Date.now();
  return (
    <ul className="space-y-1">
      {certifications.map((cert) => {
        const expired = new Date(cert.expiresAt).getTime() < now;
        return (
          <li key={cert.code} className="flex items-center gap-2 text-sm">
            <span>{cert.code}</span>
            <span className={expired ? 'text-red-600 font-medium' : 'text-gray-500'}>
              {expired ? 'Expired' : 'Valid'} until {new Date(cert.expiresAt).toLocaleDateString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

`apps/web/src/app/workers/page.tsx`:
```tsx
import Link from 'next/link';
import { WorkerSummaryView } from '../../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorkers(): Promise<WorkerSummaryView[]> {
  const res = await fetch(`${API_URL}/workers`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load workers');
  return res.json();
}

export default async function WorkersPage() {
  const workers = await fetchWorkers();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Workers</h1>
      <ul className="space-y-2">
        {workers.map((w) => (
          <li key={w._id}>
            <Link href={`/workers/${w._id}`} className="text-blue-600 hover:underline">
              {w.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`apps/web/src/app/workers/[id]/page.tsx`:
```tsx
import { WorkerDetailView } from '../../../lib/types';
import { CertificationList } from '../../../components/CertificationList';
import { StoreGrid } from '../../../components/StoreGrid';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorker(id: string): Promise<WorkerDetailView> {
  const res = await fetch(`${API_URL}/workers/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load worker');
  return res.json();
}

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const worker = await fetchWorker(params.id);
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">{worker.name}</h1>
      <p className="text-gray-500 mb-6">{worker._id}</p>

      <h2 className="text-lg font-semibold mb-2">Certifications</h2>
      <CertificationList certifications={worker.certifications} />

      <h2 className="text-lg font-semibold mt-8 mb-2">Currently holding</h2>
      <StoreGrid assets={worker.currentlyHolding} />

      <h2 className="text-lg font-semibold mt-8 mb-2">Reservations</h2>
      <ul className="space-y-2">
        {worker.reservations.map((r) => (
          <li key={r._id} className="text-sm border rounded p-3">
            {r.assetId}: {new Date(r.startAt).toLocaleString()} – {new Date(r.endAt).toLocaleString()} ({r.status})
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx jest CertificationList --config jest.config.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/components/CertificationList.tsx apps/web/src/components/CertificationList.test.tsx apps/web/src/app/workers
git commit -m "feat(web): add worker list and detail pages with certification expiry flags"
```

### Task 22: Reservations page

**Files:**
- Create: `apps/web/src/components/ReservationForm.tsx`
- Create: `apps/web/src/app/reservations/page.tsx`
- Create: `apps/web/src/app/reservations/ReservationsClient.tsx`
- Test: `apps/web/src/components/ReservationForm.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`newIdempotencyKey` (Task 18), `ReservationView` (Task 21).
- Produces: `<ReservationForm onCreated={...} />`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/ReservationForm.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservationForm } from './ReservationForm';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
}));

describe('ReservationForm', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('shows a validation error and does not call the API when endAt <= startAt', () => {
    render(<ReservationForm onCreated={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'DRILL-001' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    const [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-01-10T17:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T09:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    expect(screen.getByText('End must be after start')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders the conflicting window from a mocked 409 response', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new Error('Overlaps an existing reservation from 2027-01-10T09:00:00.000Z to 2027-01-10T17:00:00.000Z'),
    );

    render(<ReservationForm onCreated={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'DRILL-001' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    const [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-01-10T12:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T20:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    await waitFor(() => expect(screen.getByText(/Overlaps an existing reservation/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx jest ReservationForm --config jest.config.js`
Expected: FAIL — `Cannot find module './ReservationForm'`.

- [ ] **Step 3: Write `ReservationForm.tsx` and the reservations pages**

`apps/web/src/components/ReservationForm.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { apiFetch, newIdempotencyKey } from '../lib/api';

export function ReservationForm({ onCreated }: { onCreated: () => void }) {
  const idempotencyKey = useMemo(() => newIdempotencyKey(), []);
  const [assetId, setAssetId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!startAt || !endAt) {
      setError('Start and end are required');
      return;
    }
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      setError('End must be after start');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          assetId,
          workerId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          idempotencyKey,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border rounded-lg p-4 mb-6">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          type="text"
          placeholder="Asset ID"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className="border rounded px-3 py-2"
          disabled={submitting}
        />
        <input
          type="text"
          placeholder="Worker ID"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="border rounded px-3 py-2"
          disabled={submitting}
        />
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="border rounded px-3 py-2" disabled={submitting} />
        <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="border rounded px-3 py-2" disabled={submitting} />
      </div>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      <button type="button" onClick={submit} disabled={submitting} className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50">
        Reserve
      </button>
    </div>
  );
}
```

`apps/web/src/app/reservations/ReservationsClient.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { ReservationForm } from '../../components/ReservationForm';
import { ReservationView } from '../../lib/types';

export function ReservationsClient({ reservations }: { reservations: ReservationView[] }) {
  const router = useRouter();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Reservations</h1>
      <ReservationForm onCreated={() => router.refresh()} />
      <ul className="space-y-2">
        {reservations.map((r) => (
          <li key={r._id} className="text-sm border rounded p-3">
            {r.assetId} — {r.workerId}: {new Date(r.startAt).toLocaleString()} – {new Date(r.endAt).toLocaleString()} ({r.status})
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`apps/web/src/app/reservations/page.tsx`:
```tsx
import { ReservationsClient } from './ReservationsClient';
import { ReservationView } from '../../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchReservations(): Promise<ReservationView[]> {
  const res = await fetch(`${API_URL}/reservations`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load reservations');
  return res.json();
}

export default async function ReservationsPage() {
  const reservations = await fetchReservations();
  return <ReservationsClient reservations={reservations} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx jest ReservationForm --config jest.config.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ReservationForm.tsx apps/web/src/components/ReservationForm.test.tsx apps/web/src/app/reservations
git commit -m "feat(web): add reservations page with client-side window validation"
```

### Task 23: History / "as of" page

**Files:**
- Create: `apps/web/src/app/history/HistoryClient.tsx`
- Create: `apps/web/src/app/history/page.tsx`
- Test: `apps/web/src/app/history/HistoryClient.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` (Task 18), `AssetSummary`/`StoreGrid` (Task 19).
- Produces: `<HistoryClient />` rendered by `/history`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/history/HistoryClient.test.tsx`:
```tsx
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HistoryClient } from './HistoryClient';
import { apiFetch } from '../../lib/api';

jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn(),
}));

describe('HistoryClient', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockImplementation((path: string) => {
      if (path === '/assets') {
        return Promise.resolve([{ _id: 'DRILL-001', kind: 'drill', requiresCertification: null }]);
      }
      return Promise.resolve({ asOf: new Date().toISOString(), assets: {} });
    });
  });

  it('loads asset metadata and the current store snapshot on mount', async () => {
    render(<HistoryClient />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/assets'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/store'));
  });

  it('fetches the store as of the selected timestamp using an ISO query param', async () => {
    render(<HistoryClient />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/assets'));

    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-08-01T12:00' } });

    const expectedIso = new Date('2026-08-01T12:00').toISOString();
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(`/store?asOf=${encodeURIComponent(expectedIso)}`);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx jest history/HistoryClient --config jest.config.js`
Expected: FAIL — `Cannot find module './HistoryClient'`.

- [ ] **Step 3: Write `HistoryClient.tsx` and `page.tsx`**

`apps/web/src/app/history/HistoryClient.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { AssetSummary, StoreGrid } from '../../components/StoreGrid';

interface AssetMeta {
  _id: string;
  kind: string;
  requiresCertification: string | null;
}

interface StoreResponse {
  asOf: string;
  assets: Record<string, { status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE'; holderId: string | null }>;
}

export function HistoryClient() {
  const [assetMeta, setAssetMeta] = useState<AssetMeta[]>([]);
  const [asOfInput, setAsOfInput] = useState('');
  const [snapshot, setSnapshot] = useState<AssetSummary[]>([]);

  useEffect(() => {
    apiFetch<AssetMeta[]>('/assets').then(setAssetMeta);
  }, []);

  const loadAsOf = async (meta: AssetMeta[], asOfIso?: string) => {
    const query = asOfIso ? `?asOf=${encodeURIComponent(asOfIso)}` : '';
    const response = await apiFetch<StoreResponse>(`/store${query}`);
    setSnapshot(
      meta.map((m) => {
        const state = response.assets[m._id];
        return {
          _id: m._id,
          kind: m.kind,
          requiresCertification: m.requiresCertification,
          status: state?.status ?? 'IN_STORE',
          currentHolderId: state?.holderId ?? null,
          upcomingReservation: null,
        };
      }),
    );
  };

  useEffect(() => {
    if (assetMeta.length > 0) loadAsOf(assetMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta]);

  const handleTimestampChange = (value: string) => {
    setAsOfInput(value);
    if (value) loadAsOf(assetMeta, new Date(value).toISOString());
  };

  const handleNow = () => {
    setAsOfInput('');
    loadAsOf(assetMeta);
  };

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Store history</h1>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="datetime-local"
          aria-label="As of"
          value={asOfInput}
          onChange={(e) => handleTimestampChange(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <button type="button" onClick={handleNow} className="px-3 py-1 border rounded">
          Now
        </button>
      </div>
      <StoreGrid assets={snapshot} />
    </main>
  );
}
```

`apps/web/src/app/history/page.tsx`:
```tsx
import { HistoryClient } from './HistoryClient';

export default function HistoryPage() {
  return <HistoryClient />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx jest history/HistoryClient --config jest.config.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/history
git commit -m "feat(web): add as-of history page reusing the shared store grid"
```

---

## Phase 7 — Integration & wrap-up

### Task 24: Scripted end-to-end test of the brief's main scenario

**Files:**
- Modify: `apps/api/package.json` (add `supertest`, `@types/supertest` devDependencies)
- Create: `apps/api/src/main-scenario.e2e.test.ts`

**Interfaces:**
- Consumes: `seed` (Task 17), the fully wired `AppModule` (Tasks 9-15).
- Produces: nothing new — this test exercises the real HTTP surface end-to-end and doubles as the literal script for the screen recording.

- [ ] **Step 1: Add test dependencies**

Add to `apps/api/package.json` devDependencies: `"supertest": "^7.0.0"`, `"@types/supertest": "^6.0.2"`.

Run (from `apps/api`): `npm install`

- [ ] **Step 2: Write the failing test**

`apps/api/src/main-scenario.e2e.test.ts`:
```ts
// This test walks the brief's "main scenario" verbatim against a freshly seeded store, and
// doubles as the literal script to follow when recording the submission video: issue -> a
// concurrent second issue rejected, twice at once -> a backdated return -> a correction of
// that return's time -> an "as of" query an hour before the sequence, checked for consistency
// with the live /assets endpoint.
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import { seed } from './scripts/seed';

describe('Main scenario (e2e)', () => {
  let app: INestApplication;
  const fixedNow = new Date('2026-09-08T12:00:00Z');
  const RESERVED_SEED_ASSETS = new Set(['DRILL-001', 'GRIND-002', 'LADR-003', 'GASD-006']);

  beforeAll(async () => {
    await seed(process.env.MONGO_URI!, fixedNow);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues, rejects a concurrent second issue, accepts a backdated return, corrects it, and answers an as-of query consistently', async () => {
    const assetsBefore = await request(app.getHttpServer()).get('/assets').expect(200);
    const scenarioAsset = assetsBefore.body.find(
      (a: { _id: string; status: string; requiresCertification: string | null }) =>
        a.status === 'IN_STORE' && a.requiresCertification === null && !RESERVED_SEED_ASSETS.has(a._id),
    );
    expect(scenarioAsset).toBeDefined();
    const scenarioAssetId = scenarioAsset._id;
    const scenarioWorkerA = 'worker-ana-rios';
    const scenarioWorkerB = 'worker-ben-cole';
    const sequenceStart = new Date('2026-09-08T08:00:00Z');

    // 1. Issue.
    await request(app.getHttpServer())
      .post('/movements/issue')
      .send({ assetId: scenarioAssetId, workerId: scenarioWorkerA, occurredAt: sequenceStart.toISOString(), idempotencyKey: 'e2e-issue-1' })
      .expect(201);

    // 2. Try to issue the same asset again, concurrently, twice at once.
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer())
        .post('/movements/issue')
        .send({ assetId: scenarioAssetId, workerId: scenarioWorkerB, idempotencyKey: 'e2e-issue-race-a' }),
      request(app.getHttpServer())
        .post('/movements/issue')
        .send({ assetId: scenarioAssetId, workerId: scenarioWorkerB, idempotencyKey: 'e2e-issue-race-b' }),
    ]);
    const raceStatuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : null));
    expect(raceStatuses.filter((s) => s === 409)).toHaveLength(2);

    // 3. Return it with a backdated time.
    const backdatedReturnAt = new Date(sequenceStart.getTime() + 4 * 60 * 60 * 1000);
    const returnRes = await request(app.getHttpServer())
      .post('/movements/return')
      .send({ assetId: scenarioAssetId, workerId: scenarioWorkerA, occurredAt: backdatedReturnAt.toISOString(), idempotencyKey: 'e2e-return-1' })
      .expect(201);

    // 4. Correct that time.
    const correctedReturnAt = new Date(backdatedReturnAt.getTime() + 60 * 60 * 1000);
    await request(app.getHttpServer())
      .post(`/movements/${returnRes.body._id}/correct`)
      .send({ occurredAt: correctedReturnAt.toISOString(), reason: 'Logged the return an hour early', idempotencyKey: 'e2e-correct-1' })
      .expect(201);

    // 5. Ask what the store looked like an hour before all of this: this asset should not
    //    appear held by anyone yet.
    const asOfBefore = new Date(sequenceStart.getTime() - 60 * 60 * 1000);
    const storeBefore = await request(app.getHttpServer())
      .get(`/store?asOf=${encodeURIComponent(asOfBefore.toISOString())}`)
      .expect(200);
    expect(storeBefore.body.assets[scenarioAssetId]?.status ?? 'IN_STORE').toBe('IN_STORE');
    expect(storeBefore.body.assets[scenarioAssetId]?.holderId ?? null).toBeNull();

    // 6. The "as of now" answer must be consistent with every other screen (the live /assets endpoint).
    const storeNow = await request(app.getHttpServer()).get('/store').expect(200);
    const assetNow = await request(app.getHttpServer()).get(`/assets/${scenarioAssetId}`).expect(200);
    expect(storeNow.body.assets[scenarioAssetId].status).toBe(assetNow.body.status);
    expect(storeNow.body.assets[scenarioAssetId].holderId).toBe(assetNow.body.currentHolderId);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `apps/api`): `npx jest main-scenario --config jest.config.js`
Expected: FAIL — `Cannot find module 'supertest'` (until Step 1's install completes) or a real assertion failure if the seed/wiring has a gap — investigate and fix the underlying module rather than adjusting the test's expectations, per the "no placeholders, real behavior" rule this whole plan follows.

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/api`): `npx jest main-scenario --config jest.config.js`
Expected: PASS — 1 test covering the full six-step scenario.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/src/main-scenario.e2e.test.ts
git commit -m "test(api): add end-to-end main-scenario test (doubles as recording script)"
```

### Task 25: README

**Files:**
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks; this is the terminal task.

- [ ] **Step 1: Write the README**

Replace the contents of the root `README.md` with:

```markdown
# The Equipment Ledger

A site-store equipment ledger: issue and return tools to workers, reserve them ahead of time, and answer "who held what at any past instant" — provably correct under real concurrency, not just in the happy path.

## Stack

Next.js (App Router) + NestJS + MongoDB + TypeScript, in an npm workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`).

## Running it

1. Start MongoDB (a single-node replica set, required for the transactions the concurrency guarantees below depend on):
   \`\`\`bash
   docker compose up -d
   \`\`\`
2. Install dependencies and run both apps:
   \`\`\`bash
   npm install
   npm run dev
   \`\`\`
   API on `http://localhost:4000`, web app on `http://localhost:3000`.

## Seeding

\`\`\`bash
npm run seed
\`\`\`

Deterministic and repeat-safe: it always drops and rebuilds the collections it owns, so running it twice never doubles the store, and the same command always produces the same story (which asset is out of service, which worker has an expired certification, which movement was corrected, etc.) — only the absolute timestamps shift to stay anchored around "now," so the seeded data (and the overdue/outstanding items in it) always looks current whenever you run it.

## Invariant checks

\`\`\`bash
npm run check-invariants
\`\`\`

Independently replays the entire movement ledger and checks it against the live, denormalized asset state — this is "read the ledger straight out of Mongo and check it says the same thing the screens do," runnable any time, not just right after seeding. It also checks for double-open movements, overlapping active reservations, and correction-chain integrity. Exits non-zero and prints every violation it finds.

## The model, and why

- **Movements are the ledger.** The `movements` collection is an append-only log of things that actually happened (`ISSUE`, `RETURN`, `OUT_OF_SERVICE`, `BACK_IN_SERVICE`). Every movement carries both `occurredAt` (business time — when it happened, which a keeper can backdate) and `recordedAt` (system time — when it was written, never edited). Rejected requests (a refused issue, an out-of-service asset) are never written here — only things that actually happened go in the ledger.
- **Assets carry denormalized current state** (`status`, `currentHolderId`) purely for fast "who holds what right now" reads. It is never the source of truth — the invariant checker's whole job is proving it always agrees with what replaying the ledger produces.
- **Corrections are new records, not edits.** Fixing a wrongly logged time inserts a new movement referencing the original (`correctionOf`/`correctedBy`); the original is never mutated, so the history always shows that a mistake was made and fixed, not a rewritten past.
- **"As of" reconstruction** replays the ledger (substituting corrected values where a correction exists) up to any instant and derives the store's state at that moment — the same replay function backs both the historical `/store?asOf=` endpoint and the invariant checker, so there is exactly one implementation of "what does the ledger say happened" in the whole system.
- We used **Mongoose** (code-first schema classes, the same spirit as EF Core entity classes) with **migrate-mongo** for index/replica-set migrations, rather than Prisma — Prisma's MongoDB connector doesn't expose the raw `findOneAndUpdate`-with-filter and manual transaction-session control the concurrency mechanics below need.

## How concurrent issue is made impossible, and what it costs

**"One holder, ever" is enforced by a single MongoDB document update, not a lock:**

\`\`\`ts
Asset.findOneAndUpdate(
  { _id: assetId, status: 'IN_STORE' },
  { $set: { status: 'ISSUED', currentHolderId, currentMovementId } },
)
\`\`\`

MongoDB guarantees single-document updates are atomic. Under two simultaneous issue requests for the same asset, exactly one query matches `status: 'IN_STORE'` and succeeds; the other matches nothing and gets a clean `409`. That's the literal line that makes double-issue impossible — no lock, no transaction, no race window, and it costs nothing beyond the write you'd do anyway. The Movement insert happens in a short transaction alongside this update purely so the audit trail and live state can never diverge on a crash — the transaction is a consistency device here, not the concurrency control.

**Reservation overlap** can't use the same trick, because "no overlap" is a check against a *range of other documents*, not an equality check on one document. Instead, every reservation write first bumps a per-asset `asset_locks` nonce inside a transaction — giving two concurrent reservation attempts on the same asset something to write-conflict on, so MongoDB aborts and retries the loser — before checking for an overlapping window and inserting. Net effect: reservation creation is serialized per asset without a hand-rolled lock/timeout system.

**Cost:** MongoDB transactions require a replica set even for a single node (handled in `docker-compose.yml`), and reservation writes retry on transient write-conflict rather than always succeeding on the first attempt.

**Idempotency:** every mutating request carries a client-generated `idempotencyKey`, unique-indexed on `movements` and `reservations`. A retry with the same key hits a duplicate-key error, which is interpreted as "already applied" and returns the original result — this is what makes a double-click, a retried request, or a refresh mid-submit land exactly once.

## What's knowingly left out

- **Corrections fix timing and detail, not "this movement shouldn't have happened at all."** There's no reversal-movement type — a correction can move a return's time, but not un-issue an asset that was issued in error. A real reversal design would need its own state-machine thinking about what "undo" means once other movements have happened after it.
- **No bitemporal "what did we believe at time T" queries** — only business-time ("what was actually true at time T") reconstruction, which is what the brief asks for. A system-time axis (tracking what the ledger *looked like* to a past query, before later corrections) would need every read to also pin a `recordedAt` cutoff, not just `occurredAt`.
- **Reservation `EXPIRED` status is computed lazily on read**, not by a background job — there's nothing in this system that needs to fire on a schedule at this scale.
- **No auth, roles, or permissions** — per the brief's own scope discipline. The keeper/worker "pick a name from a list" flow is cosmetic identification, not access control.

## What I'd do with another day

1. **Reversal movements** — a proper "this issue should never have happened" undo, distinct from a timing correction, with its own effect on current state.
2. **A materialized snapshot for `/store?asOf=`** if the ledger grew past the point where an in-memory replay over an indexed query stays single-digit milliseconds — not needed at this seed's scale, but the first thing I'd profile before it became one.
3. **Real auth and a keeper entity** — right now "who's on the hatch" is a cosmetic, unauthenticated label; a real deployment needs it to be an actual identity.
4. **A small reservation-to-issue handoff UI** — right now issuing against a reservation works via the API (`reservationId` on the issue request), but the dashboard doesn't yet surface "issue this asset against its upcoming reservation" as a one-click action from the reservations list.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README covering setup, model rationale, and concurrency guarantees"
```

---

## Self-review notes

- **Spec coverage:** every numbered invariant in spec §1 maps to a task (one-holder → Task 9 concurrency test; reservation overlap → Task 12 concurrency test; certification gate → Task 9's cert check; out-of-service → Task 13; late entries → the `occurredAt`/`recordedAt` split baked into the Movement schema in Task 3 and exercised throughout; corrections → Task 11; nothing-twice → Task 8's idempotency helper, exercised in Tasks 9/10/11/12; any-instant → Tasks 7/15/16). Spec §7 (frontend) is covered by Tasks 18-23. Spec §8 (seed/invariants) by Tasks 16-17. Spec §9 (testing strategy) is threaded through every task's own test step plus Task 24's e2e pass. Spec §10 (deliverables) is Task 25 plus the incremental-commit discipline every task already follows. Spec §11's gaps are written into Task 25's README verbatim.
- **Placeholder scan:** no task contains "TBD," "add validation," or "similar to Task N" — every step has real, complete code. The one deliberately open-ended step is Task 25's README content, which is documentation prose, not a code placeholder, and is written out in full.
- **Type consistency fixes made during authoring:** `Movement.workerId` (Task 3's schema), `MovementResult.workerId` (Task 9), and `RawMovement`/`EffectiveMovement.workerId` (Task 7) were all corrected from `string` to `string | null` after Task 13 revealed that system-initiated `OUT_OF_SERVICE`/`BACK_IN_SERVICE` movements (an asset going out of service while nobody holds it) have no natural worker — this is reflected consistently everywhere `workerId` appears on a Movement-shaped type. `Reservation.workerId` and `ReservationResult.workerId` were deliberately left as required `string`, since a reservation always names a specific worker. `AssetsService` (Task 13) is extended in place by Task 14 rather than duplicated; `WorkersService` (Task 14) depends on `AssetsService.findAll()` rather than re-deriving upcoming-reservation logic. `StoreService.getStoreAsOf` (Task 15) and `check-invariants.ts` (Task 16) both consume the exact same `RawMovement`/`resolveEffectiveMovements`/`replayStoreState` signatures from Task 7, so there is exactly one implementation of ledger replay in the codebase, per the design's own emphasis on that point.
