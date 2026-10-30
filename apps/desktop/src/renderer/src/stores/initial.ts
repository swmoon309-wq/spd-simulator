import { getEntry } from '../catalog'
import { defaultParams } from '../lib/params'
import { defaultRunSettings } from '../lib/runSettings'

/** 앱을 처음 열 때의 모델과 입력. 실험 슬라이스와 프로젝트 슬라이스가 같은 값에서 시작한다. */
export const initialEntry = getEntry('brooks')
export const initialParams = defaultParams(initialEntry)
export const initialRun = defaultRunSettings(initialEntry)
