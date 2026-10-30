import { z } from 'zod'

/**
 * 모델 문서(`ModelDoc`, 설계 08의 3장)와 모델 파일(`.spd-model.json`)의 형식. 이 파일은 zod만 쓴다(메인 프로세스도 읽는다).
 * 엔진의 `ModelDef`(계산에 쓰는 정의)는 여기서 **구조만** 보고(객체인지, 한도), 변수·수식의 검증과 컴파일은 renderer의 `lib/modelDoc.ts`가
 * 엔진으로 한다.
 */
export const MODEL_DOC_VERSION = 1
export const MODEL_FILE_FORMAT = 'spd-model'
export const MODEL_FILE_EXTENSION = '.spd-model.json'
/** 사용자 모델 id의 접두사. 내장 모델 id와 겹치지 않게 한다. */
export const USER_MODEL_PREFIX = 'user-'

/** 한도(설계 08의 4.1). 프로젝트 파일 상한 5 MB 안에서 모델이 차지하는 몫을 제한한다. */
export const MODEL_LIMITS = {
  /** 변수(상수·Level·Rate·Auxiliary) 합계. 내장 AI 보조 모델이 200개를 넘어 300으로 올렸다(직렬화 크기 한도 `docBytes`가 실제 상한). */
  variables: 300,
  expression: 1000,
  tablePoints: 100,
  tables: 50,
  sectors: 20,
  /** 모델 안의 설명·메모 글자 합계 */
  textBytes: 20 * 1024,
  /** 직렬화한 `ModelDoc` 전체 */
  docBytes: 1024 * 1024,
  kpis: 12,
  params: 200,
  presets: 12,
  name: 100
} as const

const finite = z.number().refine(Number.isFinite, '유한한 수여야 합니다')
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문자·숫자·_만 쓸 수 있습니다').max(64)
const label = z.string().min(1).max(MODEL_LIMITS.name)
const unit = z.string().max(40)

const paramSpec = z.object({
  name,
  group: z.string().min(1).max(MODEL_LIMITS.name),
  min: finite,
  max: finite,
  step: finite.refine((v) => v > 0, '0보다 커야 합니다'),
  integer: z.boolean().optional()
})

const kpiKind = z.enum(['final', 'max', 'min', 'atCompletion', 'timeOfMax', 'integral'])
export type KpiKind = z.infer<typeof kpiKind>

const kpiSpec = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(40),
  label,
  unit,
  kind: kpiKind,
  variable: name,
  better: z.enum(['lower', 'higher', 'none']),
  group: z.enum(['schedule', 'cost', 'quality', 'risk']),
  decimals: z.number().int().min(0).max(6)
})

const specSchema = z.object({
  /** 모든 상수는 파라미터여야 한다(카탈로그 공통 규칙). */
  params: z.array(paramSpec).max(MODEL_LIMITS.params),
  /** 그래프에 고를 수 있는 변수. 없으면 상수가 아닌 모든 변수(라벨은 이름). */
  variables: z.array(z.object({ name, label, unit })).max(MODEL_LIMITS.variables).optional(),
  defaultVariable: name.optional(),
  /** 변수가 조건을 처음 만족한 시각이 완료일. 없으면 완료일·채택·통제가 비활성이다. */
  completion: z.object({ variable: name, op: z.enum(['<=', '>=', '<', '>']), value: finite }).optional(),
  kpis: z.array(kpiSpec).max(MODEL_LIMITS.kpis),
  staffVariable: name.optional(),
  /** 있어야 통제(Earned Value)와 채택을 쓸 수 있다. */
  evm: z
    .object({
      totalTasks: z.object({ param: name }),
      credits: z.array(z.object({ variable: name, label, weight: finite.refine((w) => w >= 0 && w <= 1, '0~1이어야 합니다') })).min(1).max(8),
      effortVariable: name
    })
    .optional(),
  size: z.object({ param: name, unit: z.string().min(1).max(20), slocPerUnit: finite.nullable() }).optional(),
  presets: z.array(z.object({ label, overrides: z.record(z.string(), finite) })).max(MODEL_LIMITS.presets)
})
export type ModelSpec = z.infer<typeof specSchema>

const viewSchema = z.object({
  positions: z.record(z.string(), z.object({ x: finite, y: finite })).default({}),
  sectors: z
    .array(z.object({ id: z.string().min(1).max(40), name: label, color: z.string().max(20).optional(), members: z.array(z.string()).max(MODEL_LIMITS.variables), collapsed: z.boolean().optional() }))
    .max(MODEL_LIMITS.sectors)
    .default([]),
  notes: z.array(z.object({ x: finite, y: finite, text: z.string().max(2000) })).max(100).default([])
})

const infoSchema = z.object({
  description: z.string().max(5000).default(''),
  author: z.string().max(100).optional(),
  createdAt: z.string().max(40),
  /** 복제한 원본(`brooks@1` 형식) */
  basedOn: z.string().max(100).optional()
})

/** 엔진의 `ModelDef`는 여기서 객체인지만 본다(깊은 검증은 엔진 스키마). */
const rawDef = z.record(z.string(), z.unknown())

export const modelDocSchema = z.object({
  docVersion: z.literal(MODEL_DOC_VERSION),
  def: rawDef,
  info: infoSchema,
  view: viewSchema.default({ positions: {}, sectors: [], notes: [] }),
  spec: specSchema
})

/** 구조만 확인한 모델 문서. `def`는 아직 `ModelDef`가 아니다. */
export type ModelDocRaw = z.infer<typeof modelDocSchema>

export const modelFileSchema = z.object({
  format: z.literal(MODEL_FILE_FORMAT),
  docVersion: z.literal(MODEL_DOC_VERSION),
  doc: modelDocSchema
})
export type ModelFileRaw = z.infer<typeof modelFileSchema>

export function isUserModelId(id: string): boolean {
  return id.startsWith(USER_MODEL_PREFIX)
}

/** 사용자 모델 id: `user-<이름의 영문 슬러그>-<무작위 8자>`. 영문이 없으면 슬러그는 `model`. */
export function newUserModelId(modelName: string, random: () => number = Math.random): string {
  const slug = modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'model'
  let suffix = ''
  for (let i = 0; i < 8; i++) suffix += Math.floor(random() * 16).toString(16)
  return `${USER_MODEL_PREFIX}${slug}-${suffix}`
}

/** 키 순서를 정렬한 JSON(같은 내용이면 같은 문자열). 배열 순서는 유지한다. `undefined` 값은 뺀다. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, walk(o[k])]))
    }
    return v
  }
  return JSON.stringify(walk(value))
}

// ---------- SHA-256 (동기, 의존성 없음) ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/** UTF-8 문자열의 SHA-256(16진수 64자). */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text)
  const bitLen = data.length * 8
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(padded.length - 4, bitLen >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = ((h[0] as number) + a) >>> 0
    h[1] = ((h[1] as number) + b) >>> 0
    h[2] = ((h[2] as number) + c) >>> 0
    h[3] = ((h[3] as number) + d) >>> 0
    h[4] = ((h[4] as number) + e) >>> 0
    h[5] = ((h[5] as number) + f) >>> 0
    h[6] = ((h[6] as number) + g) >>> 0
    h[7] = ((h[7] as number) + hh) >>> 0
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('')
}

/**
 * 모델의 내용 해시: 계산 정의(`def`)와 앱 연결(`spec`)의 정규 JSON의 SHA-256 앞 16자. 설명·화면 정보(`info`, `view`)는 결과를 바꾸지 않아 뺀다.
 * (설계 08의 4.3은 `def`만 말하지만 `spec`의 지표·완료 조건도 결과를 바꾸므로 함께 쓴다.)
 */
export function modelContentHash(doc: Pick<ModelDocRaw, 'def' | 'spec'>): string {
  return sha256Hex(canonicalJson({ def: doc.def, spec: doc.spec })).slice(0, 16)
}

export function serializeModelFile(doc: ModelDocRaw): string {
  return JSON.stringify({ format: MODEL_FILE_FORMAT, docVersion: MODEL_DOC_VERSION, doc }, null, 2) + '\n'
}

export type ModelFileParse = { ok: true; doc: ModelDocRaw } | { ok: false; message: string }

/** 모델 파일의 텍스트를 읽어 구조를 확인한다(크기 한도 포함). */
export function parseModelFileText(text: string): ModelFileParse {
  if (text.length > MODEL_LIMITS.docBytes * 1.2) return { ok: false, message: `모델 파일이 너무 큽니다(최대 ${MODEL_LIMITS.docBytes / 1024 / 1024} MB).` }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 형식이 아니어서 모델 파일로 읽을 수 없습니다.' }
  }
  const r = modelFileSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    return { ok: false, message: `모델 파일 형식이 올바르지 않습니다. ${where}${issue?.message ?? ''}` }
  }
  if (new TextEncoder().encode(canonicalJson(r.data.doc)).length > MODEL_LIMITS.docBytes) return { ok: false, message: `모델이 너무 큽니다(최대 ${MODEL_LIMITS.docBytes / 1024 / 1024} MB).` }
  return { ok: true, doc: r.data.doc }
}
