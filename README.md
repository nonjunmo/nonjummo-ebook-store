# 논준모연구소 e-book 교재 판매 사이트

Render Web Service와 SQLite를 기준으로 만든 e-book 판매 웹사이트입니다.

## 주요 기능

- e-book 목록 10개씩 보기
- 장바구니 담기 및 바로 주문
- 주문 내역, 전체 금액, 입금계좌 안내
- 주문자 개인정보 입력: 이름, 연락처, 현금영수증/세금계산서, e-mail
- 관리자 로그인
- 상품 등록
- 주문별 입금확인 및 발송완료 체크

## 환경 변수

Render Web Service에 아래 환경 변수를 설정합니다.

```text
ADMIN_PASSWORD=관리자 비밀번호
SESSION_SECRET=긴 임의 문자열
BANK_ACCOUNT=입금계좌 표시 문구
DATABASE_PATH=/var/data/app.db
```

Render에서는 `PORT`를 자동으로 주입하므로 직접 설정하지 않아도 됩니다.

## Render 배포

SQLite 파일을 안정적으로 유지하려면 Render Web Service에 Persistent Disk를 붙입니다.

1. Web Service 생성 화면에서 repository를 연결합니다.
2. Build Command는 `npm install`을 사용합니다.
3. Start Command는 `npm start`를 사용합니다.
4. Environment Variables에 `DATABASE_PATH=/var/data/app.db`를 설정합니다.
5. Disks 설정에서 Persistent Disk를 추가합니다.
6. Disk Mount Path는 `/var/data`로 설정합니다.
7. 첫 시작 시 서버가 필요한 테이블을 자동 생성합니다.

Persistent Disk를 붙이지 않으면 배포나 재시작 후 SQLite DB 파일이 사라질 수 있습니다.

## 로컬 실행

```bash
npm install
npm start
```

로컬 기본 DB 경로는 `./data/app.db`입니다.

Windows PowerShell에서 `npm` 실행 정책 오류가 나면 `npm.cmd start`처럼 실행합니다.

## 테스트

테스트는 임시 SQLite 파일로 실행됩니다.

```bash
npm test
```

Windows PowerShell에서 실행 정책 오류가 나면 아래처럼 실행합니다.

```bash
npm.cmd test
```
