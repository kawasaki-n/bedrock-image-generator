import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { v4 as uuidv4 } from 'uuid';

export class BedrockStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 参考
    // https://zenn.dev/issy/articles/zenn-bedrock-apigw-tried-it

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    const bucket = new s3.Bucket(this, `BedrockBucket`, {
      bucketName: `bedrock-bucket-${accountId}-${region}`,
      accessControl: s3.BucketAccessControl.PRIVATE,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
    });
    const bucketFullAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:*'],
      resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
    });

    const bedrockLambdaFunctionRole = new iam.Role(this, 'BedrockLambdaFunctionRole', {
      roleName: 'bedrock-lambda-function-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        BedrockInvokeModel: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                'arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-image-generator-v1',
              ],
            }),
          ],
        }),
        S3PutObject: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject'],
              resources: [bucket.arnForObjects('*')],
            }),
          ],
        }),
      },
    });

    const bedrockLambdaFunction = new lambda.Function(this, 'BedrockLambdaFunction', {
      functionName: `bedrock-function`,
      code: lambda.Code.fromAsset(path.join(__dirname, `../src/lambda`)),
      handler: 'index.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_12,
      timeout: cdk.Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64, //X86_64,
      environment: {
        S3_BUCKET_NAME: bucket.bucketName,
        LOG_LEVEL: 'INFO',
      },
      role: bedrockLambdaFunctionRole,
      //tracing: lambda.Tracing.ACTIVE,
    });

    const api = new apigwv2.HttpApi(this, 'BedrockLambdaApi', {
      apiName: 'BedrockExecuteApi',
      corsPreflight: {
        allowHeaders: ['*'],
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
      },
    });
    api.addRoutes({
      path: '/',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('BedrockLambdaIntegration', bedrockLambdaFunction),
    });
  }
}
