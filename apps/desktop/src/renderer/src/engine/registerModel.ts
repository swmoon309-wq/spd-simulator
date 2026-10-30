import { registerEntry } from '../catalog'
import { buildEntry } from '../catalog/userModel'
import { registerUserModel } from './models'
import type { RegisterModelRequest } from './protocol'

/**
 * Worker가 `registerModel` 메시지를 받았을 때 하는 일(설계 08의 5.1). Worker의 모듈은 화면과 따로 로드되어 카탈로그도 따로이므로,
 * 정의(`def`)뿐 아니라 지표 정의(`spec`)가 든 항목(`ModelEntry`)도 여기서 합성해 둬야 Monte Carlo가 지표를 계산할 수 있다.
 * 같은 해시가 이미 등록되어 있으면 아무것도 하지 않는다. 문서는 화면이 검증을 마친 것이다.
 */
export function applyRegisterModel(req: RegisterModelRequest): boolean {
  const changed = registerUserModel(req.id, req.hash, req.doc.def)
  if (changed) registerEntry(buildEntry(req.doc, req.hash))
  return changed
}
