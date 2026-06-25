# Monitor Audio Router

Monitor Audio Router는 Chrome 창을 어느 모니터에 두었는지에 따라, 현재 활성 탭의 오디오 출력 장치를 자동으로 바꿔 주는 Chrome 확장입니다.

예를 들어 왼쪽 모니터에서는 스피커, 오른쪽 모니터에서는 헤드셋으로 소리가 나오게 설정해 두면 Chrome 창을 옮기는 것만으로 출력 장치가 전환됩니다.

## 빠른 설치

Chrome Web Store에 올린 확장이 아니므로, 현재는 GitHub Release ZIP을 내려받아 압축해제 확장으로 설치합니다.

1. [Releases](https://github.com/Kikuhn/MonitorAudioRouter/releases) 페이지를 엽니다.
2. 최신 버전의 `MonitorAudioRouter-v0.2.7.zip`을 다운로드합니다.
3. ZIP 파일을 원하는 위치에 압축 해제합니다.
4. Chrome 주소창에 `chrome://extensions`를 입력합니다.
5. 오른쪽 위 `개발자 모드`를 켭니다.
6. `압축해제된 확장 프로그램을 로드`를 누릅니다.
7. 압축을 푼 폴더 안의 `MonitorAudioRouter-v0.2.7` 폴더를 선택합니다.

설치 후 Chrome 툴바의 확장 아이콘을 눌러 모니터별 출력 장치를 설정하면 됩니다.

## 이런 경우에 유용합니다

- 모니터마다 다른 스피커, 헤드셋, HDMI 오디오 장치를 쓰는 경우
- YouTube, Twitch, 음악 스트리밍 탭을 모니터 위치에 따라 다른 장치로 듣고 싶은 경우
- Chrome의 활성 탭만 빠르게 다른 출력 장치로 바꾸고 싶은 경우
- 사이트별로 자동 라우팅 적용 여부를 제한하고 싶은 경우

## 처음 설정하기

1. 확장 아이콘을 눌러 popup을 엽니다.
2. 장치 목록이 비어 있으면 `장치 자동 스캔`을 누릅니다.
3. Chrome이 microphone 권한을 물어보면 허용합니다. 이 권한은 장치 이름과 ID를 읽기 위한 Chrome 정책 때문에 필요하며, 녹음이나 전송 목적이 아닙니다.
4. `모니터별 규칙`에서 각 모니터에 연결할 출력 장치를 선택합니다.
5. `적용 범위`를 선택합니다.
   - `모든 사이트에서 적용`: 지원되는 HTTPS 미디어 사이트에서 자동 전환을 적용합니다.
   - `등록한 사이트에서만 적용`: 직접 등록한 사이트에만 자동 전환을 적용합니다.
6. YouTube 같은 HTTPS 미디어 탭을 열고 Chrome 창을 다른 모니터로 옮겨 동작을 확인합니다.

이미 열려 있던 미디어 탭은 새로고침해야 `AudioContext` 감지가 더 안정적일 수 있습니다.

## 수동 전환 단축키

- 기본 단축키는 `Ctrl+Shift+Period`입니다.
- Chrome에서 `chrome://extensions/shortcuts`를 열면 원하는 키로 바꿀 수 있습니다.
- 단축키를 누르면 활성 탭의 출력 장치가 `시스템 기본 장치 -> 등록된 장치들` 순서로 바뀝니다.
- 단축키로 바꾼 출력은 현재 탭의 수동 override로 유지됩니다. popup의 `수동 해제`를 누르면 다시 모니터 규칙을 따릅니다.

## 지원 범위와 제한

지원 대상:

- HTTPS 웹 페이지의 `audio`, `video`, `new Audio()`
- `setSinkId()`를 지원하는 `AudioContext`
- Chrome 116 이상

제한 사항:

- `chrome://` 페이지, Chrome Web Store, 확장 실행이 차단된 페이지에는 적용할 수 없습니다.
- 사이트가 `Permissions-Policy`로 speaker/microphone 접근을 막으면 장치 전환이 제한될 수 있습니다.
- 이 확장은 `tabCapture`를 사용하지 않으므로, 탭 전체 오디오를 강제로 캡처해 재라우팅하지 않습니다.
- 모든 HTTPS 페이지에 스크립트를 계속 주입하지 않고, 실제 적용이나 장치 확인이 필요한 활성 탭에만 동적으로 주입합니다.

## 권한과 개인정보

이 확장은 다음 Chrome 권한을 사용합니다.

- `activeTab`, `tabs`, `windows`: 현재 포커스된 Chrome 창과 활성 탭을 찾습니다.
- `system.display`: Chrome 창이 어느 모니터에 있는지 판단합니다.
- `scripting`: 필요한 탭에만 라우팅 스크립트를 주입합니다.
- `contentSettings`: 장치 이름/ID 확인과 출력 전환에 필요한 microphone/sound 설정을 관리합니다.
- `storage`: 모니터별 규칙, 등록 사이트, 장치 목록, 상태 값을 저장합니다.
- `https://*/*`: HTTPS 미디어 페이지에서 출력 장치를 바꾸기 위해 필요합니다.

코드에는 `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` 같은 외부 서버 전송 로직이 없습니다. 설정과 상태는 주로 `chrome.storage.local`에 저장되며, 일부 설정 백업 키는 Chrome의 `storage.sync`에 저장될 수 있습니다. Chrome 동기화가 켜져 있으면 이 백업은 Chrome 계정 동기화 정책의 영향을 받을 수 있습니다.

## 개발자용 설치

소스 코드를 직접 확인하거나 수정하려면 저장소를 clone해서 압축해제 확장으로 로드할 수 있습니다.

```powershell
git clone https://github.com/Kikuhn/MonitorAudioRouter.git
```

그 뒤 Chrome에서 `chrome://extensions`를 열고, `압축해제된 확장 프로그램을 로드`로 clone한 프로젝트 폴더를 선택합니다.

## 개발과 검증

이 프로젝트는 런타임 의존성이 없습니다. Node.js만 있으면 현재 테스트와 문법 검사를 실행할 수 있습니다.

```powershell
npm run verify
```

릴리스용 ZIP은 다음 명령으로 만들 수 있습니다.

```powershell
npm run package:release
```

검증 명령은 다음을 실행합니다.

- `node --check content-isolated.js`
- `node --check main-world.js`
- `node --check popup.js`
- `node --check worker.js`
- `node --check shared/rule-engine.js`
- `node tests/rule-engine.test.js`
- `node tests/main-world-sink-gate.test.js`
- `node tests/worker-policy.test.js`

## 업데이트 내역

릴리스별 변경 사항은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

## 이슈 제보

버그를 제보할 때는 Chrome 버전, 운영체제, 출력 장치 구성, 재현 사이트, 확장 popup의 설정 상태를 함께 적어 주세요. 계정 정보, 토큰, 개인 URL, 민감한 장치 이름은 공유하지 마세요.

## License

MIT License. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
