# Demo aislado S3 → Lambda → S3

Este paquete crea un bucket de S3 y una Lambda para la sesión de cloud. MercadoYa no importa este paquete ni envía contenido a AWS.

La Lambda recibe eventos `ObjectCreated` solo para objetos bajo `inbox/`. Lee la imagen, acepta tipos `image/*` de hasta 5 MiB y copia los bytes a `outbox/` con metadatos `processed-at` y `source-key`. Los objetos rechazados quedan en `inbox/` y la Lambda registra el motivo.

## Recursos del demo

| Dato                 | Valor                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| Cuenta AWS           | ID del output `AccountId`, obtenido con `aws sts get-caller-identity`               |
| Región               | `us-east-1` por defecto, o el valor configurado en `CDK_DEFAULT_REGION`             |
| Bucket               | Valor del output `CloudPipelineDemoStack.BucketName`; contiene `inbox/` y `outbox/` |
| Lambda               | `mercadoya-cloud-pipeline-demo-processor`                                           |
| CloudWatch log group | `/aws/lambda/mercadoya-cloud-pipeline-demo-processor`                               |
| Runtime              | `nodejs22.x`, sobre Amazon Linux 2023                                               |

El nombre del bucket lo genera CloudFormation para evitar colisiones globales. Anota el valor de `BucketName` después del deploy y úsalo en la consola durante la clase. Node.js 22 es la versión elegida para el demo. AWS lista su fecha proyectada de deprecación para el 30 de abril de 2027; revisa la tabla de [runtimes soportados de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html) antes de reutilizar este paquete después de esa fecha.

## Preparar y desplegar

Ejecuta estos comandos desde la raíz del monorepo para instalar dependencias y verificar el paquete:

```bash
pnpm install
pnpm --filter @mercadoya/cloud-pipeline-demo typecheck
```

Usa una sesión AWS del docente. Configura un perfil con `AWS_PROFILE`, inicia sesión con `aws login` o, para IAM Identity Center, ejecuta `aws sso login --profile <perfil>`. Estas credenciales se usan solo por el CDK durante el despliegue. `apps/api`, `apps/web` y `pnpm dev` no dependen de AWS.

Desde `apps/cloud-pipeline-demo`, completa la cuenta y región del entorno, y despliega:

```bash
# Si usas un perfil, selecciona la misma cuenta para AWS CLI y CDK.
# export AWS_PROFILE="nombre-del-perfil"
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="us-east-1"

aws sts get-caller-identity

npx aws-cdk bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
npx aws-cdk deploy
```

`bootstrap` se ejecuta una vez por cuenta y región. El toolkit local queda fijado en `package.json`. El stack crea el bucket, la Lambda, el grupo de logs y la notificación. Copia los outputs `AccountId`, `Region`, `BucketName`, `FunctionName` y `LogGroupName` para completar la tabla de recursos del curso.

## Demo en la consola AWS

1. Abre S3, entra al bucket indicado por el output `BucketName`, abre `inbox/` y sube una imagen de hasta 5 MiB.
2. Abre CloudWatch Logs y el log group `/aws/lambda/mercadoya-cloud-pipeline-demo-processor`. Revisa los eventos `Validate`, `Transform` y `Persist`.
3. Regresa a S3, abre `outbox/` y abre o descarga el resultado. Si subiste la imagen en una subcarpeta, conserva esa ruta dentro de `outbox/`.

La notificación escucha `ObjectCreated` con el filtro `inbox/`. Los objetos escritos en `outbox/` no vuelven a invocar la Lambda.

## Permisos y costos

La política de ejecución de la Lambda permite `s3:GetObject` en `inbox/*`, `s3:PutObject` en `outbox/*` y escritura en el log group indicado. El bucket bloquea el acceso público, cifra con S3-managed keys y requiere HTTPS. El rol de borrado automático del bucket es un recurso auxiliar de CDK, no forma parte del rol de la Lambda.

El uso de S3, Lambda y CloudWatch puede generar cargos según la cuenta y la región. El bucket y el log group usan `RemovalPolicy.DESTROY`. `autoDeleteObjects` borra los objetos al destruir el stack. Después de la clase, elimina los recursos:

```bash
npx aws-cdk destroy
```

## Desarrollo local

El paquete se puede invocar desde la raíz con el filtro pnpm, por ejemplo `pnpm --filter @mercadoya/cloud-pipeline-demo typecheck`. No agregues imports, credenciales ni hooks de este demo en `apps/api` o `apps/web`. No participa en los flujos de Catalog, Media, Orders ni NATS.
