# 논준모연구소 e-book 교재 판매 사이트

Render Web Service와 PostgreSQL을 기준으로 만든 e-book 판매 웹사이트입니다.

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
DATABASE_URL=Render PostgreSQL Internal Database URL
ADMIN_PASSWORD=관리자 비밀번호
SESSION_SECRET=긴 임의 문자열
BANK_ACCOUNT=입금계좌 표시 문구
PORT=3000
```

Render에서는 `PORT`를 자동으로 주입하므로 직접 설정하지 않아도 됩니다.

## Render 배포

1. Render에서 PostgreSQL 데이터베이스를 생성합니다.
2. Web Service의 환경 변수 `DATABASE_URL`에 PostgreSQL의 Internal Database URL을 넣습니다.
3. Build Command는 `npm install`을 사용합니다.
4. Start Command는 `npm start`를 사용합니다.
5. 첫 시작 시 서버가 필요한 테이블을 자동 생성합니다.

## 로컬 실행

로컬 PostgreSQL을 준비한 뒤 `.env.example`을 참고해 환경 변수를 설정하고 실행합니다.

```bash
npm install
npm start
```

Windows PowerShell에서 `npm` 실행 정책 오류가 나면 `npm.cmd start`처럼 실행합니다.

## 테스트

테스트는 외부 PostgreSQL 없이 메모리 PostgreSQL(`pg-mem`)로 실행됩니다.

```bash
npm test
```

Windows PowerShell에서 실행 정책 오류가 나면 아래처럼 실행합니다.

```bash
npm.cmd test
```
