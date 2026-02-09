# Codex Adapter Guide (Oh My Prompt)

## 목적
Codex CLI의 공식 `notify` 기능을 사용해 프롬프트/응답을 수집한다.

## Codex 설정 위치
- 기본 `CODEX_HOME`: `~/.codex`
- 설정 파일: `~/.codex/config.toml`

## Codex notify 이벤트
Codex는 `notify` 설정을 통해 외부 프로그램을 호출하며, `agent-turn-complete` 이벤트를 전달한다.
이때 JSON 인자는 다음 필드를 포함한다.
- `type`
- `thread-id`
- `turn-id`
- `cwd`
- `input-messages` (array)
- `last-assistant-message` (string)

## Oh My Prompt 통합 방식
- `omp install --cli codex` 실행 시
  - `~/.config/oh-my-prompt/hooks/codex/notify.js` 생성
  - `config.toml`에 `notify = ["node", "<notify.js>"]` 추가
- notify 스크립트는 `input-messages`를 합쳐 prompt로 저장하고,
  `last-assistant-message`를 응답으로 저장한다.

## 기존 notify가 있는 경우
- Codex `notify`는 단일 커맨드만 지정 가능하다.
- 기존 notify가 있으면 `notify-wrapper.js`를 생성하여 기존 notify와 Oh My Prompt를 함께 실행한다.
- wrapper는 기존 notify 명령을 `notify-chain.json`에 저장한다.
- TOML 파싱이 실패하면 수동 병합이 필요할 수 있다.

## history.jsonl (fallback)
Codex는 로컬 히스토리를 `history.jsonl`에 저장할 수 있다.
`history.persistence = "none"`으로 설정하면 비활성화된다.
필요하면 이 파일을 백필 소스로 사용할 수 있다.

## 트러블슈팅
- `notify`가 동작하지 않으면 `config.toml` 경로와 `node` 경로를 확인한다.
- `omp status --json`으로 Codex 통합 상태를 확인한다.
