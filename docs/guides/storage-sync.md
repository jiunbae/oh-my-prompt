# Storage Sync Guide (Oh My Prompt)

## 목적
SQLite 로컬 데이터를 MinIO/S3로 동기화한다.

## 기본 개념
- SQLite가 원장(Source of truth)
- MinIO/S3는 옵션 동기화
- JSONL 청크(v2) 포맷으로 업로드

## 설정 방법
### 1) config set
```bash
omp config set storage.type minio
omp config set storage.minio.bucket oh-my-prompt
omp config set storage.minio.endpoint minio.example.com
omp config set storage.minio.accessKey your-access-key
omp config set storage.minio.secretKey your-secret-key
omp config set sync.userToken your-user-token
omp config set sync.deviceId my-macbook
```

### 2) 동기화 실행
```bash
omp sync
```

### 2-1) 동기화 상태 확인
```bash
omp sync status
```

### 2-2) 동시 실행 방지
동기화는 로컬 락을 사용한다. 필요하면 `--force`로 해제할 수 있다.

### 3) Dry-run
```bash
omp sync --dry-run
```

## 주의사항
- S3를 쓰는 경우 `storage.s3.*`로 설정한다.
- 동기화 대상이 많은 경우 `--chunk-size`로 청크 크기를 줄일 수 있다.
- 동기화는 디바이스별 체크포인트를 저장해 증분 업로드한다.
- 다중 디바이스 사용 시 `sync.deviceId`를 고유하게 설정한다.
