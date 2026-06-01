# Monitor Audio Router

Monitor Audio Router는 현재 포커스된 Chrome 창이 놓인 모니터를 기준으로, 활성 탭에서 재생되는 HTML5 오디오/비디오 및 `AudioContext` 출력을 지정한 오디오 장치로 바꾸는 Manifest V3 확장입니다.

예를 들어 왼쪽 모니터에서는 스피커, 오른쪽 모니터에서는 헤드셋으로 출력되도록 규칙을 등록해 두면 Chrome 창을 옮길 때 활성 탭의 출력 장치가 자동으로 전환됩니다.

## 요구사항

- Chrome 116 이상
- `setSinkId()`를 지원하는 HTTPS 미디어 페이지
- 출력 장치가 여러 개 연결된 Windows/macOS/Linux 환경
- 개발자 모드로 압축해제 확장을 로드할 수 있는 Chrome

## 설치

1. 이 저장소를 내려받습니다.

   ```powershell
   git clone https://github.com/Kikuhn/MonitorAudioRouter.git
   ```

2. Chrome에서 `chrome://extensions`를 엽니다.
3. 오른쪽 위 `개발자 모드`를 켭니다.
4. `압축해제된 확장 프로그램을 로드`를 누릅니다.
5. 내려받은 `MonitorAudioRouter` 프로젝트 폴더를 선택합니다.
6. 확장 아이콘 popup에서 출력 장치, 적용 범위, 모니터별 규칙을 등록합니다.

## 사용 흐름

1. 확장 아이콘 popup을 엽니다.
2. 장치 목록이 비어 있으면 `장치 자동 스캔`을 누릅니다. Chrome의 장치 노출 정책 때문에 microphone 권한 허용이 필요할 수 있습니다.
3. `모니터별 규칙`에서 각 모니터에 적용할 출력 장치를 선택합니다.
4. `적용 범위`를 선택합니다.
   - `모든 사이트에서 적용`: 모든 HTTPS 사이트에서 창 위치에 따른 출력 전환을 적용합니다.
   - `등록한 사이트에서만 적용`: popup에서 등록한 사이트에만 모니터 규칙을 적용합니다.
5. YouTube 같은 HTTPS 미디어 페이지를 활성 탭으로 둡니다.
6. Chrome 창을 다른 모니터로 옮기면 창 중심점이 들어간 모니터 규칙이 활성 탭에 적용됩니다.
7. 설치 전에 이미 열려 있던 미디어 탭은 새로고침하면 `AudioContext` 감지가 더 안정적입니다.

## 단축키

- 기본 단축키는 `Ctrl+Shift+Period`입니다.
- Chrome에서 `chrome://extensions/shortcuts`를 열면 원하는 키로 바꿀 수 있습니다.
- 단축키를 누르면 활성 탭의 출력 장치가 `시스템 기본 장치 -> 등록된 장치들` 순서로 바뀝니다.
- 단축키 전환은 현재 활성 탭에 대한 수동 override로 유지됩니다. popup의 `수동 해제`를 누르면 다시 모니터 규칙을 따릅니다.

## 지원 범위와 제한

- 지원: HTTPS 웹 페이지의 `audio`, `video`, `new Audio()`, `AudioContext`.
- 제한: `chrome://` 페이지, Chrome Web Store, 확장 실행이 차단된 페이지, `Permissions-Policy`로 speaker/microphone 접근을 막은 페이지.
- 이 확장은 `tabCapture`를 사용하지 않으므로 탭 전체 오디오를 강제로 재라우팅하지 않습니다.
- 페이지 스크립트는 모든 HTTPS 페이지에 상시 주입하지 않고, 실제 적용 또는 장치 확인이 필요한 활성 탭에 동적으로 주입합니다.
- 비기본 출력 장치를 쓰거나 장치 감지를 수행하는 origin에는 확장이 `contentSettings.microphone = allow`를 설정할 수 있습니다. 이는 Chrome의 장치 label/deviceId 노출 제약 때문이며, 녹음이나 외부 전송 목적이 아닙니다.

## 권한과 개인정보

이 확장은 다음 Chrome 권한을 사용합니다.

- `activeTab`, `tabs`, `windows`: 현재 포커스된 Chrome 창과 활성 탭을 찾고, 탭에 라우팅 명령을 전달합니다.
- `system.display`: 창 중심점이 어느 모니터에 들어가는지 판단합니다.
- `scripting`: 필요한 탭에만 content script와 main-world script를 동적으로 주입합니다.
- `contentSettings`: 장치 label/deviceId 확인 및 출력 전환을 위해 필요한 origin의 microphone/sound 설정을 관리합니다.
- `storage`: 모니터별 규칙, 등록 사이트, 장치 목록, 상태 값을 저장합니다.
- `https://*/*`: HTTPS 미디어 페이지에서 `setSinkId()` 라우팅을 적용하기 위해 필요합니다.

코드에는 `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` 같은 외부 서버 전송 로직이 없습니다. 설정과 상태는 주로 `chrome.storage.local`에 저장되며, 일부 설정 백업 키는 Chrome의 `storage.sync`에 저장될 수 있습니다. Chrome 동기화가 켜져 있으면 이 백업은 Chrome 계정 동기화 정책의 영향을 받을 수 있습니다.

## 개발과 검증

이 프로젝트는 런타임 의존성이 없습니다. Node.js만 있으면 현재 테스트와 문법 검사를 실행할 수 있습니다.

```powershell
npm run verify
```

개별 명령은 다음과 같습니다.

```powershell
npm run check
npm test
```

`npm run verify`는 다음을 실행합니다.

- `node --check content-isolated.js`
- `node --check main-world.js`
- `node --check popup.js`
- `node --check worker.js`
- `node --check shared/rule-engine.js`
- `node tests/rule-engine.test.js`
- `node tests/main-world-sink-gate.test.js`
- `node tests/worker-policy.test.js`

## 공개 전 수동 QA

- Chrome에서 압축해제 확장을 로드합니다.
- popup에서 오디오 출력 장치가 스캔되는지 확인합니다.
- 모니터별 출력 규칙을 등록합니다.
- HTTPS 미디어 탭을 활성화한 뒤 Chrome 창을 모니터 간 이동해 라우팅을 확인합니다.
- `등록한 사이트에서만 적용` 모드에서 미등록 사이트가 영향을 받지 않는지 확인합니다.
- `Ctrl+Shift+Period`로 수동 출력 전환을 확인하고, popup의 `수동 해제`로 모니터 규칙 복귀를 확인합니다.

## GitHub 공개 절차

로컬에서 최초 공개 커밋을 만들 때는 다음 흐름을 사용합니다.

```powershell
git init
git branch -M main
git add .
git commit -m "Prepare initial open source release"
```

원격 저장소 생성, GitHub 로그인, 최초 push는 저장소 소유자 계정에서 진행하세요. 기본 공개 저장소 이름은 `MonitorAudioRouter`를 권장합니다.

## 이슈 제보

버그를 제보할 때는 Chrome 버전, 운영체제, 출력 장치 구성, 재현 사이트, 확장 popup의 설정 상태를 함께 적어 주세요. 계정 정보, 토큰, 개인 URL, 민감한 장치 이름은 공유하지 마세요.

## License

MIT License. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
