# cloud-analytics-demo

Infraestructura aislada para la Sesión 6. Usa CDK v2 en TypeScript, con las mismas versiones y estructura `cdk/bin` y `cdk/lib` que `cloud-pipeline-demo`.

```text
seed/raw/*.csv -> S3 raw -> Glue crawler -> catálogo raw
                                       -> Glue job ETL -> S3 curated
                                                         -> Glue crawler -> catálogo curated -> Athena
                                                                                                -> athena-results/
```

El stack incluye S3, los dos roles IAM existentes, dos bases de Glue Data Catalog, los crawlers raw y curated, el job ETL Glue 5.0, logs y un workgroup de Athena. El job lee las seis CSV directamente desde S3 y escribe Parquet. El crawler curated registra las tablas, el job no modifica el catálogo. QuickSight se configura desde la consola en el prompt 04.

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

Las pruebas TypeScript inspeccionan la plantilla, los seis targets de cada crawler, el job, el asset, los permisos por rol y los outputs. No ejecutan recursos AWS. Las pruebas Spark de abajo ejecutan el ETL sobre las seis CSV locales.

## Mapa de recursos

| Recurso               | Nombre o output                                            | Uso                                                                               |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stack                 | `CloudAnalyticsDemoStack`                                  | Recursos de este demo                                                             |
| Bucket raw            | `RawBucketName`, `RawLocation`                             | `s3://<raw>/raw/<tabla>/<tabla>.csv`                                              |
| Bucket curated        | `CuratedBucketName`, `CuratedLocation`                     | `s3://<curated>/curated/<tabla>/`, salida Parquet del ETL                         |
| Bucket de artefactos  | `ArtifactsBucketName`                                      | Scripts y temporales de Glue, resultados de Athena                                |
| Scripts de Glue       | `GlueScriptsLocation`                                      | `s3://<artefactos>/glue/scripts/`                                                 |
| Temporales de Glue    | `GlueTempLocation`                                         | `s3://<artefactos>/glue/temp/`                                                    |
| Resultados de Athena  | `AthenaResultsLocation`                                    | `s3://<artefactos>/athena-results/`                                               |
| Base raw              | `RawDatabaseName` = `mercadoya_analytics_demo_raw`         | Tablas CSV que registra el crawler raw                                            |
| Base curated          | `CuratedDatabaseName` = `mercadoya_analytics_demo_curated` | Tablas Parquet que registra el crawler curated                                    |
| Rol de crawler        | `GlueCrawlerRoleArn`                                       | Ejecución de los crawlers raw y curated                                           |
| Rol de job            | `GlueJobRoleArn`                                           | Ejecución del ETL Glue 5.0                                                        |
| Logs del job          | `GlueJobLogGroupPrefix`                                    | `/aws-glue/mercadoya-cloud-analytics-demo/error` y `/output`, retención de 7 días |
| Workgroup Athena      | `AthenaWorkGroupName` = `mercadoya-cloud-analytics-demo`   | Engine v3, salida y cifrado SSE-S3 obligatorios                                   |
| Política de consultas | `AthenaQueryPolicyArn`                                     | Adjuntar al rol o usuario que ejecutará consultas                                 |
| Crawlers              | `RawCrawlerName`, `CuratedCrawlerName`                     | `mercadoya-cloud-analytics-demo-raw` y `mercadoya-cloud-analytics-demo-curated`   |
| Job ETL               | `GlueJobName`                                              | `mercadoya-cloud-analytics-demo-etl`, Glue 5.0, dos workers G.1X                  |
| Script versionado     | `GlueScriptAssetLocation`, `GlueScriptLocation`            | Asset publicado por CDK y destino `glue/scripts/<hash>.py`                        |
| Entorno               | `AccountId`, `Region`                                      | Cuenta y región del despliegue                                                    |

CloudFormation genera los nombres de buckets y roles para evitar colisiones. Los buckets tienen IDs raw, curated y artifacts en la plantilla y tags `DataZone` con esos valores. Los recursos que admiten tags reciben `Project=MercadoYa`, `Demo=mercadoya-cloud-analytics-demo`, `Session=06` y `Environment=demo`. Usa una instancia de este stack por cuenta y región, porque las bases, logs y workgroup tienen nombres fijos.

Los tres buckets bloquean acceso público, usan cifrado SSE-S3 y exigen HTTPS. Los prefijos son rutas de objetos, no recursos que S3 deba crear como carpetas. Los resultados y temporales están fuera del bucket curated para que el crawler curated no los catalogue.

## Despliegue opcional del docente

Para comprobar crawlers, catálogo y Athena en AWS, selecciona una sesión del docente, por ejemplo con `AWS_PROFILE` y `aws sso login --profile <perfil>`. Desde `apps/cloud-analytics-demo`:

```bash
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION="us-east-1"
aws sts get-caller-identity

pnpm bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
pnpm cdk diff
pnpm deploy --outputs-file cdk.out/outputs.json
```

Bootstrap se ejecuta una vez por cuenta y región y crea recursos del toolkit compartidos. `deploy` publica el asset Python en el bucket del toolkit y crea la infraestructura. El comando `demo:glue` copia ese asset a `GlueScriptLocation` en el bucket de artefactos existente antes de arrancar el job. La copia usa la identidad del docente y conserva los dos roles de ejecución del scaffold. `deploy` no carga las CSV ni ejecuta Glue o Athena. Revisa los cambios IAM que muestre CDK. Estos comandos no hacen commit ni push.

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

## Ejecutar el recorrido completo

Desde `apps/cloud-analytics-demo`, después de `pnpm deploy --outputs-file cdk.out/outputs.json`:

```bash
pnpm demo:glue
# También acepta otro archivo de outputs de CDK:
pnpm demo:glue /ruta/outputs.json
```

El comando comprueba que la cuenta activa coincide con `AccountId` y usa `Region` de los outputs. Copia el asset publicado al destino con hash bajo `GlueScriptsLocation`, carga las seis CSV al layout raw, ejecuta el crawler raw y exige seis tablas con las cabeceras originales. Espera a que el job termine, comprueba que cada carpeta curated contiene Parquet, ejecuta el crawler curated y consulta las seis tablas con Athena. Compara los conteos de filas con las CSV locales. El comando imprime cambios de estado y falla si un servicio devuelve error o excede el tiempo de espera.

Guarda la evidencia real en `cdk.out/glue-demo-evidence.json`, con cuenta, región, ejecuciones, rutas S3 de archivos Parquet, columnas y tipos de ambos catálogos, y conteos de Athena. Si falla, revisa el estado en AWS antes de repetir; no detiene automáticamente una ejecución al agotar la espera. Este comando reemplaza el contenido de las seis tablas curated y vuelve a cargar la semilla raw.

La identidad del docente necesita leer el asset del bucket de bootstrap, escribir en los prefijos raw y scripts, listar curated, iniciar e inspeccionar los crawlers y el job, leer ambos catálogos y consultar el workgroup Athena. Estos permisos administrativos no se añaden a `crawlerRole` ni a `jobRole`.

Para ejecutar cada etapa a mano, primero copia el script. Los valores se obtienen del archivo de outputs del despliegue:

```bash
aws s3 cp <GlueScriptAssetLocation> <GlueScriptLocation> --region <Region>
aws glue start-crawler --name mercadoya-cloud-analytics-demo-raw --region <Region>
aws glue get-crawler --name mercadoya-cloud-analytics-demo-raw --region <Region>
# Espera State=READY y LastCrawl.Status=SUCCEEDED antes de iniciar el job.
aws glue start-job-run --job-name mercadoya-cloud-analytics-demo-etl --region <Region>
aws glue get-job-run --job-name mercadoya-cloud-analytics-demo-etl --run-id <JobRunId> --region <Region>
# Espera JobRunState=SUCCEEDED antes de iniciar curated.
aws glue start-crawler --name mercadoya-cloud-analytics-demo-curated --region <Region>
aws glue get-crawler --name mercadoya-cloud-analytics-demo-curated --region <Region>
# Espera State=READY y LastCrawl.Status=SUCCEEDED antes de consultar.
aws glue get-table --database-name mercadoya_analytics_demo_curated --name orders --region <Region>
aws s3 ls <CuratedLocation>orders/ --recursive --region <Region>
```

Ambos crawlers tienen seis targets por tabla y `TableLevelConfiguration=2`, correspondiente a `raw/<tabla>` o `curated/<tabla>`. El raw apunta a cada archivo `raw/<tabla>/<tabla>.csv`. Un clasificador CSV fija coma, comillas y cabecera `PRESENT`. Ambos crawlers usan `UPDATE_IN_DATABASE` para actualizar esquemas y `LOG` para borrados. El crawler curated excluye archivos auxiliares cuyo nombre empieza con `_` o `.`.

El job usa `--TempDir=GlueTempLocation`, `--custom-logGroup-prefix=GlueJobLogGroupPrefix` y `--job-bookmark-option=job-bookmark-disable`. Su límite es una ejecución concurrente, 15 minutos y cero reintentos automáticos. No usa `Job.init/commit` ni sinks que actualicen el Data Catalog. La lectura directa de CSV conserva strings antes de tipar y permite inspeccionar las diferencias con los tipos inferidos por el crawler raw.

## Demostrar CSV a Parquet

`seed/raw/orders.csv` se carga en `<RawLocation>orders/orders.csv`. El ETL produce `<CuratedLocation>orders/part-*.snappy.parquet`, y el catálogo curated publica este esquema:

```text
order_id:string, customer_id:string, order_date:timestamp, status:string,
total_amount:decimal(18,2), currency:string, channel:string
```

Los importes `price`, `unit_price`, `line_total` y `amount` también usan `decimal(18,2)`. `stock`, `quantity` y las cantidades de inventario usan `int`. `signup_date` y `snapshot_date` usan `date`; `created_at` y `paid_at` usan `timestamp`. Los demás campos conservan `string`.

Después del crawler curated, consulta en el workgroup del demo:

```sql
SELECT order_id, order_date, status, total_amount, "$path" AS parquet_file
FROM mercadoya_analytics_demo_curated.orders
LIMIT 5;
```

`$path` muestra el archivo S3 que respalda cada fila. El output de `get-table` contiene `StorageDescriptor.Location`, `Columns` y el input format Parquet. El comando `demo:glue` guarda esas rutas y esquemas junto con los conteos, por lo que la evidencia no depende de una captura de consola.

## Criterios mínimos de calidad

- Las seis tablas deben tener las cabeceras de la semilla en el mismo orden; el job falla si cambian o si una tabla queda vacía.
- El ETL conserva todas las filas; la prueba local y `demo:glue` comparan los conteos CSV y Parquet.
- Elimina espacios exteriores y convierte vacíos, `null`, `none` y `n/a` a NULL; conserva NULL en ciudad, categoría e importes.
- Convierte fechas ISO a `date` o `timestamp` en UTC; valores inválidos quedan NULL y `paid_at` ausente sigue NULL.
- Convierte importes a `decimal(18,2)` y cantidades a `int`; no sustituye importes ausentes o inválidos por cero.
- Normaliza estados a minúsculas; conserva los valores conocidos, unifica `canceled/cancelled` por tabla y usa `unknown` para ausentes o desconocidos.
- Normaliza IDs, emails, segmento, canal y proveedor a minúsculas; moneda y almacén a mayúsculas.
- Escribe un Parquet Snappy por tabla, sin particiones ni marcador `_SUCCESS`, y sobrescribe esa carpeta en cada ejecución.

Las reglas son didácticas. Un cast inválido genera NULL, no una cuarentena; no hay deduplicación, imputación de totales ni transacción entre las seis escrituras. Si falla una tabla, vuelve a ejecutar el job completo antes de ejecutar el crawler curated.

## Validación local de Spark

La prueba usa Apache Spark 3.5.4, la versión de Glue 5.0. Desde `apps/cloud-analytics-demo`, con Docker disponible:

```bash
docker run --rm --network none --hostname localhost \
  -e SPARK_LOCAL_IP=127.0.0.1 -e PYTHONDONTWRITEBYTECODE=1 \
  -v "$PWD:/workspace" -w /workspace \
  --entrypoint /opt/spark/bin/spark-submit apache/spark:3.5.4 \
  --master 'local[2]' test/test_etl.py
```

Si no tienes la imagen, descárgala primero con `docker pull apache/spark:3.5.4`. La prueba monta el app y usa temporales locales, no credenciales AWS. Comprueba tipos y conteos para las seis CSV, fechas con zonas horarias, NULL, estados, decimales exactos, cabeceras inválidas y que una segunda escritura no duplique filas. Guarda `cdk.out/local-etl-evidence.json` con los esquemas, conteos y nombres de archivo observados. Esta evidencia local no prueba S3, IAM, los crawlers ni Athena.

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

Los crawlers y el job reutilizan las propiedades públicas del stack y sus outputs:

- Crawlers llamados `mercadoya-cloud-analytics-demo-raw` y `mercadoya-cloud-analytics-demo-curated`, con `crawlerRole`, cada uno apuntando a su ubicación y base. Ambos usan `SchemaChangePolicy` con `UpdateBehavior=UPDATE_IN_DATABASE` y `DeleteBehavior=LOG`; el rol no borra tablas ni particiones. Usa targets por tabla para los seis CSV raw.
- El job lee raw, transforma a Parquet y escribe bajo `curated/<tabla>/`. Usa `jobRole`, un script bajo `GlueScriptsLocation`, `--TempDir` con `GlueTempLocation` y, para Glue 5.0, `--custom-logGroup-prefix` con `GlueJobLogGroupPrefix`. Tiene bookmarks desactivados con `--job-bookmark-option=job-bookmark-disable`; no se conceden permisos de bookmarks. El crawler curated registra las tablas de salida; el job no modifica el catálogo.
- El grupo `/aws-glue/crawlers` es compartido por AWS Glue. El rol puede crearlo si falta y escribir solo en streams `mercadoya-cloud-analytics-demo-*`. El stack no administra ni elimina ese grupo compartido.

El docente necesita `iam:PassRole` sobre los dos ARNs de roles, con `iam:PassedToService=glue.amazonaws.com`, y los permisos de despliegue y ejecución de los crawlers y el job. Esos permisos administrativos no pertenecen a los roles de ejecución. Este demo usa S3 sin conexiones VPC, cifrado SSE-S3 y Data Catalog con control IAM. Si la cuenta administra estas bases con Lake Formation, el docente debe configurar sus grants además de IAM.

## Eliminar el demo

Todos los recursos del stack se eliminan al destruirlo. Los buckets usan `RemovalPolicy.DESTROY` y requieren vaciarse antes; no hay un rol auxiliar de borrado automático. El workgroup permite eliminación recursiva de su historial y consultas guardadas. Desde `apps/cloud-analytics-demo`, copia los nombres de los outputs antes de destruir:

```bash
aws s3 rm "s3://<RawBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "s3://<CuratedBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "s3://<ArtifactsBucketName>" --recursive --region "$CDK_DEFAULT_REGION"
pnpm destroy
```

Si hubo uploads multipart interrumpidos, abórtalos antes de eliminar el bucket. Detén los crawlers y el job del demo antes de destruir el stack. Desadjunta la política Athena de identidades externas antes de destruirla. Conserva `/aws-glue/crawlers`, que puede contener logs de otros demos. El toolkit de bootstrap no se elimina con este stack.

## Documentación AWS consultada

Referencias oficiales consultadas para el scaffold y este cambio, el 1 de octubre de 2026. Se contrastaron las propiedades de crawlers, job y asset con CDK 2.270.0 instalado:

- [CDK synth](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-synth.html) y [S3 Bucket en CDK v2](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html), síntesis, cifrado, HTTPS y eliminación.
- [Ejemplos IAM de Glue](https://docs.aws.amazon.com/glue/latest/dg/security_iam_id-based-policy-examples.html) y [prerrequisitos del crawler](https://docs.aws.amazon.com/glue/latest/dg/crawler-prereqs.html), confianza del servicio, permisos S3 y ARNs de catálogo, base y tabla.
- [Acceso de Athena al Data Catalog](https://docs.aws.amazon.com/athena/latest/ug/fine-grained-access-to-glue-resources.html), permisos de tablas y sus recursos antecesores.
- [Políticas del workgroup](https://docs.aws.amazon.com/athena/latest/ug/example-policies-workgroup.html) y [override de configuración](https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html), consultas restringidas al workgroup y salida obligatoria.
- [Acceso S3 desde Athena](https://docs.aws.amazon.com/athena/latest/ug/s3-permissions.html), permisos de la identidad que consulta; [permisos S3 de Athena](https://docs.aws.amazon.com/athena/latest/ug/cross-account-permissions.html) y [uploads multipart de S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), acciones de bucket y objeto.
- [Logs de Glue 5.0](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuous-logging.html) y [logs del crawler](https://docs.aws.amazon.com/glue/latest/dg/troubleshooting-contact-support.html), ubicaciones y configuración del job.
- [CfnCrawlerProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnCrawlerProps.html) y [nivel de tabla del crawler](https://docs.aws.amazon.com/glue/latest/dg/crawler-table-level.html), targets S3 y configuración JSON con nivel absoluto 2.
- [SchemaChangePolicy](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnCrawler.SchemaChangePolicyProperty.html), valores `UPDATE_IN_DATABASE` y `LOG`.
- [Clasificador CSV en CDK](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnClassifier.CsvClassifierProperty.html) y [clasificadores CSV de Glue](https://docs.aws.amazon.com/glue/latest/dg/add-classifier.html), cabeceras y delimitadores.
- [CfnJobProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnJobProps.html) y [versiones de Glue](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html), Glue 5.0 con Spark 3.5.4, workers y argumentos.
- [Bookmarks de Glue](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html), `job-bookmark-disable` para procesar siempre la semilla completa.
- [Assets S3 de CDK](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_assets.Asset.html), empaquetado y ubicación del script publicado.

La validación de este cambio es local mediante typecheck, synth, pruebas de plantilla y pruebas Spark con las seis CSV. La ejecución real de Glue y Athena queda pendiente de un despliegue y `pnpm demo:glue` en la cuenta del docente.
