# AI_HANDOFF.md

## 1. 프로젝트명

스마트 그룹웨어

## 2. 현재 기술 스택

- Runtime: Node.js
- Server: Express
- View: EJS 템플릿
- Styling: CSS, Font Awesome CDN 아이콘
- DB: SQLite, Node.js 내장 `node:sqlite`의 `DatabaseSync`
- Auth: `express-session` 기반 세션 로그인
- Password: `bcryptjs` 해시 저장
- Upload/Excel: `multer`, `xlsx`
- Deploy: Fly.io
- App URL: `https://smart-groupware.fly.dev/`
- Local path: `C:\groupware-mvp`
- Local run: `node app.js`

## 3. 현재 구현된 주요 기능

- 로그인
  - `/login`
  - 세션 기반 로그인/로그아웃
  - 비밀번호는 `bcryptjs` 해시 사용
  - 기본 계정 비밀번호는 현재 `1234`

- 대시보드
  - `/dashboard`
  - 출근/퇴근 버튼
  - 오늘 출근/퇴근 시간, 근무 상태, 월간 근무일수/지각 횟수
  - 결재 대기 건수, 내 결재 진행 상태
  - 최신 공지사항/게시글
  - IT장애신고 링크: `https://it-manager.fly.dev/report`

- 근태
  - 직원 출근/퇴근 체크
  - 개인 근태 이력
  - 관리자 전체 근태 조회/수정/CSV 다운로드
  - 기본 근무시간 설정

- 전자결재
  - 결재 문서 작성
  - 임시저장/상신
  - 결재자 승인/반려
  - 결재 이력 조회
  - 결재 양식 관리

- 업무일지
  - `/work-logs`
  - 일일업무일지, 주간업무일지, 월간업무일지
  - 목록/작성/상세/수정
  - 상태: `임시저장`, `제출완료`, `검토완료`
  - 일반 사용자는 본인 일지만 기본 조회
  - 관리자는 전체 조회 및 검토의견/검토완료 처리 가능
  - 제출완료 상태는 일반 사용자 수정 불가
  - 상세 화면에서 수정/목록/인쇄 제공

- 관리자
  - `/admin`
  - 사용자, 부서, 권한, 근태, 결재 양식, 결재라인, 게시판, 시스템 설정, 관리자 로그
  - 사용자 엑셀 일괄 등록
  - 사용자 선택 삭제는 실제 삭제가 아니라 `inactive` 처리
  - 사용자 목록 정렬 및 사용중/삭제됨/전체 필터

- 인사관리
  - `/hr`
  - 직원 기본정보 관리
  - 직원 목록/등록/상세/수정
  - 퇴사 처리
  - 근로계약서 등록/삭제
  - 인사변동 이력 등록/삭제

- 급여관리
  - `/payroll`
  - 연봉정보 등록/수정/목록
  - 월별 급여 등록/수정/상세/삭제
  - 급여 대시보드 통계

- 기타
  - 게시판/공지사항
  - 조직도
  - Outlook Web 좌측 메뉴 링크
  - 시스템 설정
  - 관리자 로그

## 4. 주요 라우트 목록

### 인증

- `GET /`
- `GET /login`
- `POST /login`
- `POST /logout`

### 직원 기능

- `GET /dashboard`
- `POST /attendance/check-in`
- `POST /attendance/check-out`
- `GET /attendance`
- `GET /approvals`
- `GET /approvals/new`
- `POST /approvals/new`
- `GET /approvals/my`
- `GET /approvals/:id`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `GET /boards`
- `GET /boards/:id`
- `POST /boards/:id/posts`
- `GET /organization`
- `GET /profile`

### 업무일지

- `GET /work-logs`
- `GET /work-logs/daily`
- `GET /work-logs/weekly`
- `GET /work-logs/monthly`
- `GET /work-logs/daily/new`
- `GET /work-logs/weekly/new`
- `GET /work-logs/monthly/new`
- `POST /work-logs/:type/new`
- `GET /work-logs/:id`
- `GET /work-logs/:id/edit`
- `POST /work-logs/:id/edit`
- `POST /work-logs/:id/review`

### 관리자

- `GET /admin`
- `GET /admin/users`
- `GET /admin/users/:id/edit`
- `POST /admin/users`
- `POST /admin/users/bulk-delete`
- `POST /admin/users/bulk-deactivate`
- `GET /admin/users/import-template`
- `POST /admin/users/import`
- `POST /admin/users/:id/update`
- `POST /admin/users/:id/reset-password`
- `POST /admin/users/:id/deactivate`
- `GET /admin/departments`
- `POST /admin/departments`
- `POST /admin/departments/:id/update`
- `GET /admin/roles`
- `POST /admin/roles/:id`
- `GET /admin/attendance`
- `POST /admin/attendance/:userId/update`
- `GET /admin/attendance/export`
- `GET /admin/approval-forms`
- `POST /admin/approval-forms`
- `POST /admin/approval-forms/:id/update`
- `GET /admin/approval-lines`
- `GET /admin/boards`
- `POST /admin/boards`
- `POST /admin/boards/:id/update`
- `POST /admin/posts/:id/hide`
- `GET /admin/settings`
- `POST /admin/settings`
- `GET /admin/logs`

### 인사관리

- `GET /hr`
- `GET /hr/employees`
- `GET /hr/employees/new`
- `POST /hr/employees`
- `GET /hr/employees/:id`
- `GET /hr/employees/:id/edit`
- `POST /hr/employees/:id`
- `POST /hr/employees/:id/delete`
- `POST /hr/contracts`
- `POST /hr/contracts/:id/delete`
- `POST /hr/histories`
- `POST /hr/histories/:id/delete`

### 급여관리

- `GET /payroll`
- `GET /payroll/salaries`
- `GET /payroll/salaries/new`
- `POST /payroll/salaries`
- `GET /payroll/salaries/:id/edit`
- `POST /payroll/salaries/:id`
- `GET /payroll/monthly`
- `GET /payroll/monthly/new`
- `POST /payroll/monthly`
- `GET /payroll/monthly/:id`
- `GET /payroll/monthly/:id/edit`
- `POST /payroll/monthly/:id`
- `POST /payroll/monthly/:id/delete`

## 5. 주요 파일 구조

- `app.js`
  - Express 앱 진입점
  - 세션/정적파일/EJS 설정
  - 전역 locals 설정: `currentUser`, `currentPath`, `companyName`, `outlookUrl`, `itReportUrl`, `flash`
  - 라우트 연결: auth, workLogs, employee, admin, hr, payroll

- `database/db.js`
  - SQLite 연결 및 `run/get/all` 헬퍼
  - 테이블 자동 생성
  - 샘플 데이터 생성
  - 시스템 설정/관리자 로그 헬퍼

- `routes/auth.js`
  - 로그인/로그아웃

- `routes/employee.js`
  - 직원 대시보드, 근태, 전자결재, 게시판, 조직도, 프로필

- `routes/admin.js`
  - 관리자 대시보드, 사용자/부서/권한/근태/결재/게시판/설정/로그
  - 엑셀 사용자 일괄 등록

- `routes/workLogs.js`
  - 일일/주간/월간 업무일지

- `routes/hr.js`
  - 인사관리

- `routes/payroll.js`
  - 급여관리

- `routes/middleware.js`
  - 로그인/관리자/결재권자/권한 확인 미들웨어

- `views/`
  - EJS 화면 템플릿
  - `views/partials/head.ejs`: 직원용 사이드바
  - `views/partials/admin-nav.ejs`: 관리자용 사이드바
  - `views/admin/`: 관리자 화면
  - `views/hr/`: 인사관리 화면
  - `views/payroll/`: 급여관리 화면
  - `views/work-*.ejs`: 업무일지 화면

- `public/css/style.css`
  - 전체 UI 스타일
  - 좌측 사이드바, 카드형 UI, 업무일지, 인사/급여 화면 스타일 포함

- `fly.toml`
  - Fly.io 앱 설정
  - 앱 이름: `smart-groupware`
  - DB/업로드 경로: `/app/data`

- `Dockerfile`
  - Node 22 slim 기반 배포 이미지

## 6. 최근 변경사항

- 왼쪽 메뉴에 `업무일지` 추가
- 업무일지 메인 페이지 카드 3개 추가
  - 일일업무일지 작성
  - 주간업무일지 작성
  - 월간업무일지 작성
- 업무일지 목록/작성/상세/수정/관리자 검토 기능 추가
- 관리자 사이드바 `스마트 그룹웨어` 클릭 시 `/dashboard`로 이동하도록 수정
- `Admin Console` 보조 텍스트 정렬 조정
- 기본 샘플 계정 비밀번호를 `1234`로 변경
- 인사관리/급여관리 기능이 현재 코드에 존재함
- Fly.io 배포 완료
  - URL: `https://smart-groupware.fly.dev/`
- 배포 후 정상 확인된 페이지
  - `/login`
  - `/dashboard`
  - `/admin`
  - `/work-logs`

## 7. DB 또는 샘플 데이터 구조

주요 테이블:

- `users`
  - 로그인 계정
  - `username`, `password_hash`, `name`, `email`, `phone`, `department_id`, `position`, `role`, `status`
  - 기본 샘플: `admin`, `user01`, `manager01`

- `departments`
  - 부서 정보

- `attendance`
  - 출퇴근 기록

- `approval_forms`
  - 결재 양식

- `approvals`
  - 결재 문서

- `approval_lines`
  - 결재자 라인/승인/반려 이력

- `boards`, `posts`, `comments`, `attachments`
  - 게시판/첨부 구조

- `admin_logs`
  - 관리자 작업 로그

- `system_settings`
  - 회사명, 근무시간 등 설정

- `work_logs`
  - 업무일지
  - 주요 컬럼:
    - `log_type`: `daily`, `weekly`, `monthly`
    - `user_id`, `department_id`, `position`
    - `entry_date`, `period_start`, `period_end`, `target_month`
    - `summary`
    - `content_json`
    - `status`: `임시저장`, `제출완료`, `검토완료`
    - `review_comment`, `reviewed_by`, `reviewed_at`
  - 샘플: 일일/주간/월간 각 1건

- `employees`
  - 인사관리 직원 마스터
  - `employee_no`, `name`, `department_id`, `position`, `employment_status`, 입사/퇴사/연락처/계약 관련 필드

- `hr_contracts`
  - 근로계약서 정보

- `hr_histories`
  - 인사변동 이력

- `payroll_salary_standards`
  - 연봉/월 기본급/수당 기준

- `payroll_monthly_records`
  - 월별 급여 지급 기록

- `payroll_adjustments`
  - 급여 조정/수당/공제 확장용 테이블

## 8. 권한 구조

현재 role:

- `admin`
  - 관리자 전체 기능 접근
  - 업무일지 전체 조회/검토 가능
  - 인사/급여 기능 접근 가능

- `manager`
  - 결재권자
  - 현재 인사/급여 접근 권한에는 기본 포함되어 있지 않음

- `employee`
  - 일반 직원
  - 본인 근태/결재/업무일지 중심

- `hr`
  - 코드상 권한 미들웨어에서 허용되는 역할
  - 인사관리 접근 대상 역할로 설계됨

- `payroll`
  - 코드상 권한 미들웨어에서 허용되는 역할
  - 급여관리 접근 대상 역할로 설계됨

개선 필요:

- 인사관리/급여관리 라우트별 권한 정책을 더 명확히 분리
- 급여 조회/수정은 `admin` 또는 `payroll`만 허용해야 함
- 인사 정보는 `admin` 또는 `hr`만 허용해야 함
- 역할별 메뉴 노출과 서버 권한 검증을 반드시 같이 유지

## 9. 남은 작업 TODO

- 인사관리 상세 보완
  - 조직/직급 마스터 분리
  - 퇴사자 복구/검색 필터 개선
  - 엑셀 업로드/다운로드

- 급여관리 상세 보완
  - 접근 권한 강화
  - 민감정보 마스킹
  - 급여명세서 출력
  - 엑셀 다운로드
  - 지급확정/지급완료 워크플로우

- 파일 업로드
  - 결재 첨부
  - 게시판 첨부
  - 인사 계약서 첨부

- 권한 강화
  - `/hr`, `/payroll` 라우트 권한 재점검
  - 서버/API 권한 검증 누락 점검

- 보안
  - 운영용 비밀번호 정책 강화
  - 기본 비밀번호 `1234`는 운영 전 변경 필요
  - 세션 secret 환경변수 적용

- 감사로그
  - 인사/급여/업무일지 수정/삭제/검토 로그 강화

- 엑셀 다운로드
  - 사용자, 근태, 인사, 급여, 업무일지 목록 다운로드

- UI/UX
  - 모바일 테이블 표시 개선
  - 업무일지 인쇄 스타일 추가 보완
  - 인사/급여 화면 디자인 톤 통일

## 10. 주의사항

- 기존 대시보드, 로그인, 근태, 전자결재 기능이 깨지지 않도록 작업할 것
- 민감정보는 화면/다운로드/로그에서 마스킹 필요
- 급여정보는 관리자/급여 담당자만 접근 가능하도록 서버 권한 검증 필요
- 인사정보도 관리자/인사 담당자만 접근하도록 권한을 점검할 것
- 배포 전 반드시 로그인 테스트 수행
  - `admin / 1234`
  - `user01 / 1234`
  - `manager01 / 1234`
- Fly.io 배포 시 기존 볼륨 `/app/data`의 SQLite DB가 유지됨
- DB 스키마는 `database/db.js`에서 앱 시작 시 `CREATE TABLE IF NOT EXISTS`로 보장
- 운영 전 기본 비밀번호와 샘플 계정은 반드시 변경/삭제할 것
- PowerShell 프로필 오류가 명령 출력에 반복 표시될 수 있으나 프로젝트 자체 오류는 아님

## 새 Codex 창에서 이어서 작업할 때 사용할 시작 프롬프트

```text
현재 프로젝트는 C:\groupware-mvp 에 있는 “스마트 그룹웨어”입니다.
먼저 AI_HANDOFF.md를 읽고, app.js / database/db.js / routes / views / public/css/style.css 구조를 확인한 뒤 이어서 작업해주세요.

기술 스택은 Node.js, Express, EJS, SQLite(node:sqlite), express-session, bcryptjs입니다.
배포 URL은 https://smart-groupware.fly.dev/ 입니다.

이미 구현된 기능은 로그인, 대시보드, 근태, 전자결재, 업무일지, 게시판, 조직도, 관리자, 인사관리, 급여관리입니다.
기본 계정은 admin / 1234 입니다.

작업 시 기존 로그인, 대시보드, 근태, 전자결재, 업무일지 기능이 깨지지 않도록 라우팅과 화면 이동을 검증해주세요.
특히 /hr 와 /payroll 은 민감정보가 있으므로 권한 검증을 강화하는 방향으로 작업해주세요.
```
