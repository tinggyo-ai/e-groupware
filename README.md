# 그룹웨어 MVP 웹 시스템

중소기업에서 바로 테스트할 수 있는 심플한 그룹웨어 MVP입니다. Node.js, Express, SQLite, EJS 기반이며 로그인, 권한, 출퇴근 체크, 전자결재, 게시판, 조직도, 관리자 페이지를 포함합니다.

Node.js 24 이상에서 제공되는 내장 SQLite 모듈을 사용하므로 별도 SQLite 네이티브 패키지 빌드가 필요 없습니다.

## 설치 및 실행

```bash
npm install
node app.js
```

브라우저에서 `http://localhost:3000`으로 접속합니다.

## 기본 계정

| 권한 | 아이디 | 비밀번호 | 이름 |
| --- | --- | --- | --- |
| admin | admin | 1234 | 시스템관리자 |
| employee | user01 | 1234 | 김창교 |
| manager | manager01 | 1234 | 홍길동 |

## 주요 기능

- 로그인 세션 및 bcrypt 비밀번호 해시
- 직원 대시보드: 출근/퇴근, 오늘 근태, 월간 통계, 결재 현황, 공지/게시글, Outlook Web 바로가기
- 근태: 출근/퇴근 체크, 개인 월별 이력, 관리자 전체 조회/수정/CSV 다운로드
- 전자결재: 기본 양식, 문서 작성, 임시저장, 상신, 승인/반려, 결재 이력
- 게시판: 공지사항, 자유게시판, 글 작성, 검색, 관리자 숨김 처리
- 조직도: 부서 및 직원 목록, 이름/부서 검색
- 관리자: 사용자, 부서, 권한, 근태, 결재 양식, 게시판, 시스템 설정, 관리자 로그
- Outlook 메일: 대시보드에서 `https://outlook.office.com` 바로가기 제공

## DB 초기화

앱 최초 실행 시 `database/groupware.sqlite` 파일이 자동 생성되고 테이블 및 샘플 데이터가 입력됩니다.

초기 상태로 다시 시작하려면 서버를 종료한 뒤 `database/groupware.sqlite` 파일을 삭제하고 다시 실행하면 됩니다.

## 프로젝트 구조

```text
groupware-mvp/
  app.js
  package.json
  database/
    db.js
    groupware.sqlite
  routes/
    auth.js
    employee.js
    admin.js
    middleware.js
  views/
    partials/
    admin/
  public/
    css/style.css
```

## 확장 메모

- 첨부파일 테이블은 준비되어 있으며 실제 업로드는 3단계 기능으로 확장하면 됩니다.
- Outlook은 1차 버전에서 Web 바로가기만 제공하며, 향후 Microsoft Graph API 연동을 별도 모듈로 추가하기 좋게 URL 사용을 분리했습니다.
- 관리자 API와 화면은 `requireAdmin` 미들웨어로 서버 권한 검증을 수행합니다.
