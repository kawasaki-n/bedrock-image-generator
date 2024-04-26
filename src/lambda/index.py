# 必要なライブラリを読み込み
import os
import json
import boto3
import base64
import uuid
import random
from botocore.config import Config
from botocore.exceptions import ClientError
from logging import getLogger, INFO

logger = getLogger()
logger.setLevel(INFO)

bedrock_runtime = boto3.client("bedrock-runtime", region_name="us-east-1")
# 署名プロセスには、署名バージョン4(SigV4)を指定
my_config = Config(region_name="us-east-1", signature_version="s3v4")
s3 = boto3.client("s3", config=my_config)
# bucket_name = '作成したS3バケット名'


def lambda_handler(event, context):
    try:
        logger.info("start")
        logger.info("event: {}".format(event))
        logLevel = os.environ.get("LOG_LEVEL", "INFO")
        logger.setLevel(logLevel)

        # 作成したS3バケット名を環境変数から取得
        bucket_name = os.environ.get("S3_BUCKET_NAME")
        if bucket_name is None:
            raise Exception("S3 bucket name was not specified.")

        # S3に保存するためのランダムなオブジェクト名を生成
        random_uuid = uuid.uuid4().hex
        # 入力を受け取る
        body = json.loads(event["body"])
        input_text = body.get("input_text")

        # Amazon Bedrockで用意した基盤モデルへAPIリクエストし、画像を生成する
        base64_image_data = invoke_titan_image(input_text)
        image_data = base64.b64decode(base64_image_data)
        object_key = (
            f"generated_images/{random_uuid}/image_{input_text.replace(' ', '_')}.jpg"
        )

        # 生成された画像をS3にアップロード
        s3.put_object(
            Bucket=bucket_name,
            Key=object_key,
            Body=image_data,
            ContentType="image/jpeg",
        )
        # 署名付きURLを取得
        presigned_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket_name, "Key": object_key},
            ExpiresIn=3600,
        )

        # 署名付きURLを返す
        return {"statusCode": 200, "body": json.dumps({"presigned_url": presigned_url})}
    except Exception as e:
        logger.exception(str(e))
        return {"statusCode": 500, "body": json.dumps(str(e))}
    finally:
        logger.info("complete.")


def invoke_titan_image(prompt):
    try:
        request = json.dumps(
            {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {"text": prompt},
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "quality": "standard",
                    "cfgScale": 8.0,
                    "height": 512,
                    "width": 512,
                    "seed": random.randint(0, 2147483646),
                },
            }
        )
        response = bedrock_runtime.invoke_model(
            modelId="amazon.titan-image-generator-v1", body=request
        )
        response_body = json.loads(response["body"].read())
        base64_image_data = response_body["images"][0]
        return base64_image_data
    except ClientError as e:
        logger.error(f"Couldn't invoke Titan Image generator: {e}")
        raise
