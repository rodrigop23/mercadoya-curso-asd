# cloud-analytics-demo

Infraestructura aislada para la Sesión 6. Usa CDK v2 en TypeScript, con las mismas versiones y estructura `cdk/bin` y `cdk/lib` que `cloud-pipeline-demo`.

```text
seed/raw/*.csv -> S3 raw -> Glue crawler -> catálogo raw
                                       -> Glue job ETL -> S3 curated
                                                         -> Glue crawler -> catálogo curated -> Athena
                                                                                                -> athena-results/
```

El stack prepara S3, IAM, dos bases de Glue Data Catalog, logs del job y un workgroup de Athena. Los crawlers, el script ETL y el job quedan para los siguientes pasos del curso. El catálogo empieza sin tablas y curated empieza vacío. QuickSight se configura desde la consola en el prompt 04.

## Sintetizar sin desplegar

Desde la raíz del monorepo:

```bash
pnpm install
pnpm --filter @mercadoya/cloud-analytics-demo typecheck
pnpm --filter @mercadoya/cloud-analytics-demo test
pnpm --filter @mercadoya/cloud-analytics-demo synth --no-lookups
```

`synth` genera `apps/cloud-analytics-demo/cdk.out/CloudAnalyticsDemoStack.template.json`. No requiere bootstrap ni crea recursos AWS. No hay lookups de recursos existentes. La región predeterminada es `us-east-1`; `CDK_DEFAULT_REGION` permite cambiarla. Para una síntesis local con cuenta explícita de ejemplo:

```bash
CDK_DEFAULT_ACCOUNT=111122223333 CDK_DEFAULT_REGION=us-east-1 \
  pnpm --filter @mercadoya/cloud-analytics-demo synth --no-lookups
```

Las pruebas inspeccionan la plantilla, la separación de buckets, los permisos por rol y la ubicación obligatoria de resultados. No ejecutan crawlers, jobs ni consultas AWS.

## Mapa de recursos

| Recurso               | Nombre o output                                            | Uso                                                                               |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stack                 | `CloudAnalyticsDemoStack`                                  | Recursos de este demo                                                             |
| Bucket raw            | `RawBucketName`, `RawLocation`                             | `s3://<raw>/raw/<tabla>/<tabla>.csv`                                              |
| Bucket curated        | `CuratedBucketName`, `CuratedLocation`                     | `s3://<curated>/curated/<tabla>/`, futura salida Parquet                          |
| Bucket de artefactos  | `ArtifactsBucketName`                                      | Scripts y temporales de Glue, resultados de Athena                                |
| Scripts de Glue       | `GlueScriptsLocation`                                      | `s3://<artefactos>/glue/scripts/`                                                 |
| Temporales de Glue    | `GlueTempLocation`                                         | `s3://<artefactos>/glue/temp/`                                                    |
| Resultados de Athena  | `AthenaResultsLocation`                                    | `s3://<artefactos>/athena-results/`                                               |
| Base raw              | `RawDatabaseName` = `mercadoya_analytics_demo_raw`         | Tablas CSV que registrará el crawler raw                                          |
| Base curated          | `CuratedDatabaseName` = `mercadoya_analytics_demo_curated` | Tablas Parquet que registrará el crawler curated                                  |
| Rol de crawler        | `GlueCrawlerRoleArn`                                       | Ejecución de los futuros crawlers raw y curated                                   |
| Rol de job            | `GlueJobRoleArn`                                           | Ejecución del futuro ETL                                                          |
| Logs del job          | `GlueJobLogGroupPrefix`                                    | `/aws-glue/mercadoya-cloud-analytics-demo/error` y `/output`, retención de 7 días |
| Workgroup Athena      | `AthenaWorkGroupName` = `mercadoya-cloud-analytics-demo`   | Engine v3, salida y cifrado SSE-S3 obligatorios                                   |
| Política de consultas | `AthenaQueryPolicyArn`                                     | Adjuntar al rol o usuario que ejecutará consultas                                 |
| Entorno               | `AccountId`, `Region`                                      | Cuenta y región del despliegue                                                    |

CloudFormation genera los nombres de buckets y roles para evitar colisiones. Los buckets tienen IDs raw, curated y artifacts en la plantilla y tags `DataZone` con esos valores. Los recursos que admiten tags reciben `Project=MercadoYa`, `Demo=mercadoya-cloud-analytics-demo`, `Session=06` y `Environment=demo`. Usa una instancia de este stack por cuenta y región, porque las bases, logs y workgroup tienen nombres fijos.

Los tres buckets bloquean acceso público, usan cifrado SSE-S3 y exigen HTTPS. Los prefijos son rutas de objetos, no recursos que S3 deba crear como carpetas. Los resultados y temporales están fuera del bucket curated para que el crawler curated no los catalogue.

## Despliegue opcional del docente

No se necesita desplegar para completar este paso. Para probarlo después, selecciona una sesión AWS del docente, por ejemplo con `AWS_PROFILE` y `aws sso login --profile <perfil>`. Desde `apps/cloud-analytics-demo`:

```bash
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="us-east-1"
aws sts get-caller-identity

pnpm bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
pnpm cdk diff
pnpm deploy --outputs-file cdk.out/outputs.json
```

Bootstrap se ejecuta una vez por cuenta y región y crea recursos del toolkit compartidos. `deploy` crea solo la infraestructura descrita; no sube datos ni ejecuta Glue o Athena. Revisa los cambios IAM que muestre CDK. Estos comandos no hacen commit ni push.

## Cargar la semilla existente

La fuente es [`seed/raw/`](./seed/raw/), con `customers.csv`, `products.csv`, `orders.csv`, `order_items.csv`, `inventory_snapshots.csv` y `payments.csv`. Consulta [`seed/README.md`](./seed/README.md) para schema, integridad y KPIs. No hace falta regenerarla ni obtener otro dataset.

Después de desplegar, desde `apps/cloud-analytics-demo`, usa el output `RawLocation` y la misma cuenta y región:

```bash
export RAW_LOCATION="s3://<valor-de-RawBucketName>/raw/"
for file in seed/raw/*.csv; do
  table="$(basename "$file" .csv)"
  aws s3 cp "$file" "${RAW_LOCATION}${table}/${table}.csv" \
    --region "$CDK_DEFAULT_REGION"
done
aws s3 ls "$RAW_LOCATION" --recursive --region "$CDK_DEFAULT_REGION"
```

Cada CSV queda en su propia carpeta para separar las seis tablas con schemas distintos. El docente que realiza la carga necesita `s3:PutObject` sobre `raw/*`; los roles de ejecución de Glue solo leen raw. La carga es manual y el stack no la ejecuta durante synth o deploy.

El generador existente es opcional. Desde la raíz del monorepo, `node apps/cloud-analytics-demo/seed/generate.mjs` regenera los CSV con la semilla predeterminada. Los datos son sintéticos y no leen ni escriben Postgres, NATS ni servicios operativos de MercadoYa.

## Permisos IAM y extensiones

| Identidad                               | Permisos concedidos                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crawler, confianza `glue.amazonaws.com` | Leer objetos y listar `raw/*` y `curated/*`; leer, crear y actualizar tablas y particiones en las dos bases del demo; escribir logs de sus crawlers     |
| Job, confianza `glue.amazonaws.com`     | Leer `raw/*`, scripts y catálogo raw; leer, escribir y borrar `curated/*` y `glue/temp/*`, con operaciones multipart; escribir en sus dos log groups    |
| Política Athena                         | Ejecutar, detener y leer consultas del workgroup; leer el catálogo curated y `curated/*`; leer y escribir `athena-results/*`, con operaciones multipart |

Todas las acciones se enumeran y todos los `Allow` usan ARNs acotados. Los comodines de objetos y tablas cubren archivos, tablas y particiones que aún no existen, dentro de los prefijos o bases del demo. `s3:ListBucket` usa condiciones `s3:prefix`; `s3:GetBucketLocation` y `s3:ListBucketMultipartUploads` usan ARN de bucket. Esta última acción de Athena lista uploads del bucket de artefactos, pero no permite leer ni modificar scripts o temporales.

Las políticas S3 contienen un `Deny` con principal `*` para exigir HTTPS a cualquier identidad. No concede acceso. No se adjuntan `AWSGlueServiceRole` ni `AmazonAthenaFullAccess`, ni se conceden acciones con comodines o `Resource: "*"` en las políticas de ejecución. Las políticas del toolkit de bootstrap son independientes del stack.

La política Athena queda sin adjuntar porque SQL sobre S3 usa los permisos de quien consulta. Adjunta `AthenaQueryPolicyArn` a una identidad existente del docente mediante IAM o Identity Center. El stack no crea un rol asumible por `athena.amazonaws.com`. Con una sesión que tenga esta política, se puede comprobar el workgroup sin depender de permisos de navegación de la consola:

```bash
aws athena start-query-execution \
  --work-group mercadoya-cloud-analytics-demo \
  --query-string 'SELECT 1' \
  --region "$CDK_DEFAULT_REGION"
# Usa el QueryExecutionId devuelto para consultar estado y resultados.
aws athena get-query-execution --query-execution-id <id> --region "$CDK_DEFAULT_REGION"
aws athena get-query-results --query-execution-id <id> --region "$CDK_DEFAULT_REGION"
```

La política permite consultas de lectura sobre curated cuando existan sus tablas. No permite DDL ni CTAS/INSERT sobre los datos curated. Las pantallas de consola que enumeran recursos de toda la cuenta pueden necesitar permisos adicionales en la identidad del docente.

Para los siguientes prompts, reutiliza las propiedades públicas del stack y sus outputs:

- Crawlers llamados `mercadoya-cloud-analytics-demo-raw` y `mercadoya-cloud-analytics-demo-curated`, con `crawlerRole`, cada uno apuntando a su ubicación y base. Configura `SchemaChangePolicy` con `UpdateBehavior=UPDATE_IN_DATABASE` y `DeleteBehavior=LOG`; el rol no borra tablas ni particiones. Usa targets por tabla para los seis CSV raw.
- El futuro job lee raw, transforma a Parquet y escribe bajo `curated/<tabla>/`. Usa `jobRole`, un script bajo `GlueScriptsLocation`, `--TempDir` con `GlueTempLocation` y, para Glue 5.0, `--custom-logGroup-prefix` con `GlueJobLogGroupPrefix`. Desactiva bookmarks con `--job-bookmark-option=job-bookmark-disable`; no se conceden permisos de bookmarks. El crawler curated registra las tablas de salida; el job no modifica el catálogo.
- El grupo `/aws-glue/crawlers` es compartido por AWS Glue. El rol puede crearlo si falta y escribir solo en streams `mercadoya-cloud-analytics-demo-*`. El stack no administra ni elimina ese grupo compartido.

El docente necesita `iam:PassRole` sobre los dos ARNs de roles, con `iam:PassedToService=glue.amazonaws.com`, y los permisos de creación/ejecución de los crawlers y el job al incorporarlos. Esos permisos administrativos no pertenecen a los roles de ejecución. Este demo usa S3 sin conexiones VPC, cifrado SSE-S3 y Data Catalog con control IAM. Si la cuenta administra estas bases con Lake Formation, el docente debe configurar sus grants además de IAM.

## Eliminar el demo

Todos los recursos del stack se eliminan al destruirlo. Los buckets usan `RemovalPolicy.DESTROY` y requieren vaciarse antes; no hay un rol auxiliar de borrado automático. El workgroup permite eliminación recursiva de su historial y consultas guardadas. Desde `apps/cloud-analytics-demo`, copia los nombres de los outputs antes de destruir:

```bash
aws s3 rm "s3://<RawBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "s3://<CuratedBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "s3://<ArtifactsBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
pnpm destroy
```

Si hubo uploads multipart interrumpidos, abórtalos antes de eliminar el bucket. Detén cualquier crawler o job agregado en pasos posteriores y elimina sus recursos si se crearon fuera del stack. Desadjunta la política Athena de identidades externas antes de destruirla. Conserva `/aws-glue/crawlers`, que puede contener logs de otros demos. El toolkit de bootstrap no se elimina con este stack.

## Documentación AWS consultada

Referencias oficiales verificadas el 1 de octubre de 2026:

- [CDK synth](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-synth.html) y [S3 Bucket en CDK v2](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html), síntesis, cifrado, HTTPS y eliminación.
- [Ejemplos IAM de Glue](https://docs.aws.amazon.com/glue/latest/dg/security_iam_id-based-policy-examples.html) y [prerrequisitos del crawler](https://docs.aws.amazon.com/glue/latest/dg/crawler-prereqs.html), confianza del servicio, permisos S3 y ARNs de catálogo, base y tabla.
- [Acceso de Athena al Data Catalog](https://docs.aws.amazon.com/athena/latest/ug/fine-grained-access-to-glue-resources.html), permisos de tablas y sus recursos antecesores.
- [Políticas del workgroup](https://docs.aws.amazon.com/athena/latest/ug/example-policies-workgroup.html) y [override de configuración](https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html), consultas restringidas al workgroup y salida obligatoria.
- [Acceso S3 desde Athena](https://docs.aws.amazon.com/athena/latest/ug/s3-permissions.html), permisos de la identidad que consulta; [permisos S3 de Athena](https://docs.aws.amazon.com/athena/latest/ug/cross-account-permissions.html) y [uploads multipart de S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), acciones de bucket y objeto.
- [Logs de Glue 5.0](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuous-logging.html) y [logs del crawler](https://docs.aws.amazon.com/glue/latest/dg/troubleshooting-contact-support.html), ubicaciones y configuración del job.

La validación de este paso es local mediante synth y pruebas de la plantilla. La ejecución real de Glue y Athena se verifica cuando se incorporen crawlers, ETL y tablas.
