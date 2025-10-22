from __future__ import annotations

from pathlib import Path
from typing import Optional

import boto3
from botocore.client import Config


class SecureBucketClient:
    def __init__(
        self,
        bucket_name: Optional[str],
        endpoint_url: Optional[str],
        region: Optional[str],
        access_key: Optional[str],
        secret_key: Optional[str],
    ) -> None:
        self.bucket_name = bucket_name
        self._enabled = bool(bucket_name and access_key and secret_key)
        if not self._enabled:
            self._client = None
            return

        session = boto3.session.Session()
        self._client = session.client(
            's3',
            endpoint_url=endpoint_url,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(signature_version='s3v4'),
        )

    def upload_file(self, file_path: Path) -> None:
        if not self._enabled or not self._client:
            return
        object_name = file_path.name
        self._client.upload_file(str(file_path), self.bucket_name, object_name)
