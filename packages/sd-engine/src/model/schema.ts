import { z } from 'zod'

const expr = z.string().min(1)

export const constantSchema = z.object({
  value: z.number(),
  unit: z.string().optional(),
  label: z.string().optional()
})

export const levelSchema = z.object({
  init: expr,
  inflows: z.array(z.string()),
  outflows: z.array(z.string()),
  unit: z.string().optional()
})

export const flowSchema = z.object({
  expr,
  unit: z.string().optional()
})

export const tableSchema = z
  .object({
    x: z.array(z.number()).min(2),
    y: z.array(z.number()).min(2),
    /** 입력(x)·출력(y)의 단위(선택). 없으면 무차원으로 본다(책 2.6.3의 권고: 기준값에 대한 비로 정규화). 단위 검사만 쓰고 계산에는 영향이 없다 */
    xUnit: z.string().optional(),
    yUnit: z.string().optional()
  })
  .refine((t) => t.x.length === t.y.length, { message: 'x와 y의 길이가 같아야 합니다' })
  .refine((t) => t.x.every((v, i) => i === 0 || v > (t.x[i - 1] as number)), {
    message: 'x는 오름차순이어야 합니다'
  })

/** 보존 법칙 항: `계수 × 변수`. 변수는 상수·Level·Rate·Auxiliary 어느 것이든 된다. */
export const invariantTermSchema = z.object({ variable: z.string().min(1), coef: z.number().default(1) })

/**
 * 불변식(보존 법칙)의 선언: 선형 결합 `Σ coef·변수`가 양변에서 같다. 구조 점검(설계 07의 4.3 S2)과 모델 시험이 같은 정의를 쓴다.
 * 모델의 결과를 바꾸지 않는 메타데이터이므로 모델 `version`을 올리지 않는다.
 */
export const invariantSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '영문자·숫자·_만 쓸 수 있습니다'),
  label: z.string().min(1),
  lhs: z.array(invariantTermSchema).min(1),
  rhs: z.array(invariantTermSchema).min(1),
  /** 허용하는 최대 절대 위반(|좌변 − 우변|). 부동소수 오차를 흡수한다 */
  tolerance: z.number().positive()
})

export type Invariant = z.infer<typeof invariantSchema>

export const modelDefSchema = z.object({
  meta: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    timeUnit: z.literal('day')
  }),
  time: z.object({
    start: z.number(),
    end: z.number(),
    dt: z.number().positive()
  }),
  constants: z.record(z.string(), constantSchema),
  levels: z.record(z.string(), levelSchema),
  rates: z.record(z.string(), flowSchema),
  auxiliaries: z.record(z.string(), flowSchema),
  tables: z.record(z.string(), tableSchema),
  outputs: z.array(z.string()),
  /** 선언한 불변식(선택). 없으면 점검할 보존 법칙이 없다 */
  invariants: z.array(invariantSchema).optional(),
  /** 사용자 정의 단위(선택): 별칭 이름 → 단위 문자열(예: `인월: '명·월'`). 단위 검사만 쓴다. 결과에 영향이 없어 모델 `version`을 올리지 않는다 */
  units: z.object({ aliases: z.record(z.string(), z.string()) }).optional()
})

export type ModelDef = z.infer<typeof modelDefSchema>

export function parseModelDef(input: unknown): ModelDef {
  return modelDefSchema.parse(input)
}
