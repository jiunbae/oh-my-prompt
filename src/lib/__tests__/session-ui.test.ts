import { describe, expect, it } from "vitest";
import {
  getAllSessionMessageIds,
  normalizeSessionTitleSuggestion,
  parseStoredExpandedMessageIds,
  serializeExpandedMessageIds,
  sessionMessageDomId,
  sessionMessageId,
  shouldCollapseMessage,
  SESSION_NAME_MAX_LENGTH,
} from "@/lib/session-ui";

const LONG_KOREAN_SESSION_STORY = `
문명 스타일 턴제 TUI 게임 프로토타입 기획 및 설계
개발자는 문명 시리즈와 팩토리오의 요소를 결합한 새로운 턴제 TUI 게임을 구상하며 세션을 시작했습니다.
실시간보다는 턴제 방식이 TUI 환경에 더 적합하다는 판단 하에 다양한 역할 페르소나를 활용하여 병렬 개발 및 엄격한 엔지니어링 설계를 진행했습니다.

핵심 결정
팩토리오 스타일 실시간 게임 대신 문명 스타일 턴제 방식을 선택하여 TUI 환경에서의 플레이 경험을 최적화했습니다.

개발 전략
UI/UX 디자이너, 시니어 엔지니어, LLM 에이전트 연구원 등 다양한 역할 페르소나를 도입하여 작업을 병렬화하고 견고한 설계를 달성했습니다.

품질 보증
단순 단위 테스트를 넘어 실제 실행 및 e2e 테스트를 수행하고, 각 리뷰 라운드 결과를 .context/reviews 디렉토리에 역할별로 체계적으로 보관하도록 요구했습니다.

설계 복잡도
다양한 전문 역할과 병렬 처리 전략을 도입하면서 시스템 설계의 복잡도가 증가했습니다.

품질 요구사항
e2e 테스트와 체계적인 리뷰 문서화 요구를 통해 프로젝트의 품질 관리 수준이 크게 상승했습니다.

개발 속도
병렬 작업을 시도했으나 철저한 검증 과정으로 인해 전체적인 개발 속도는 안정적으로 유지되었습니다.

TUI 기반 게임의 인터랙션 복잡도를 고려하여 초기 프로토타입에서 핵심 턴 로직을 먼저 구현하고 검증하는 것이 좋습니다.
다양한 페르소나 리뷰 결과를 통합하여 최종 설계 문서에 반영하는 자동화 파이프라인을 구축하면 협업 효율성을 높일 수 있습니다.
멀티플레이어 지원 여부에 대한 구체적인 기술적 타당성 분석을 병행하여 아키텍처 결정의 리스크를 줄여야 합니다.
신뢰도: 90%
생성됨 2026. 6. 11. 오후 3:15:25
`;

describe("session UI layout helpers", () => {
  it("collapses long Korean session stories and leaves short messages open", () => {
    expect(shouldCollapseMessage(LONG_KOREAN_SESSION_STORY)).toBe(true);
    expect(shouldCollapseMessage("짧은 메시지")).toBe(false);
  });

  it("creates stable prompt and response ids for expand/collapse controls", () => {
    const prompts = [
      { id: "prompt-1", responseText: "assistant response" },
      { id: "prompt-2", responseText: null },
    ];

    expect(getAllSessionMessageIds(prompts)).toEqual([
      "prompt:prompt-1",
      "response:prompt-1",
      "prompt:prompt-2",
    ]);
    expect(sessionMessageId("prompt-1", "response")).toBe("response:prompt-1");
    expect(sessionMessageDomId("prompt 1/with spaces", "prompt")).toBe("prompt-prompt-1-with-spaces");
  });

  it("round-trips persisted expanded message state safely", () => {
    const ids = new Set(["response:prompt-1", "prompt:prompt-1"]);

    expect(parseStoredExpandedMessageIds(serializeExpandedMessageIds(ids))).toEqual(ids);
    expect(parseStoredExpandedMessageIds("not json")).toEqual(new Set());
    expect(parseStoredExpandedMessageIds(JSON.stringify([1, "prompt:ok", null]))).toEqual(new Set(["prompt:ok"]));
  });

  it("normalizes story titles before using them as session names", () => {
    const title = `"문명 스타일 턴제 TUI 게임 프로토타입 기획 및 설계"\nignored second line`;
    const longTitle = "x".repeat(180);

    expect(normalizeSessionTitleSuggestion(title)).toBe("문명 스타일 턴제 TUI 게임 프로토타입 기획 및 설계");
    expect(normalizeSessionTitleSuggestion(longTitle)).toHaveLength(SESSION_NAME_MAX_LENGTH);
    expect(normalizeSessionTitleSuggestion("", "Fallback Session")).toBe("Fallback Session");
  });
});
