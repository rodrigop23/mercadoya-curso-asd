# cloud-analytics-demo

Infraestructura aislada para la Sesión 6. Usa CDK v2 en TypeScript, con las mismas versiones y estructura `cdk/bin` y `cdk/lib` que `cloud-pipeline-demo`.

```text
seed/raw/*.csv -> S3 raw -> Glue crawler -> catálogo raw
                                       -> Glue job ETL -> S3 curated
                                                         -> Glue crawler -> catálogo curated -> Athena
                                                                                                -> athena-results/
```

El stack incluye S3, los dos roles IAM existentes, dos bases de Glue Data Catalog, los crawlers raw y curated, el job ETL Glue 5.0, logs y un workgroup de Athena. El job lee las seis CSV directamente desde S3 y escribe Parquet. El crawler curated registra las tablas, el job no modifica el catálogo. QuickSight se configura desde la consola según el [runbook de demostración](./RUNBOOK.md#quicksight-en-consola).

Para preparar y recorrer la clase, sigue el [runbook de despliegue y demostración](./RUNBOOK.md): ruta A para el stack docente ya desplegado, ruta B para deploy fresco, seis pasos operativos, QuickSight en consola, checklist de fallos y teardown. El orden de los scripts es `demo:glue` y luego `demo:athena`.

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

## Despliegue del docente

El [runbook](./RUNBOOK.md#preparar-la-sesión-docente) incluye prerrequisitos, selección de cuenta y región, bootstrap si falta y dos rutas. Si `CloudAnalyticsDemoStack` ya está en `CREATE_COMPLETE`, parte de `cdk.out/outputs.json` o regenera ese archivo desde CloudFormation. Para un deploy fresco, desde `apps/cloud-analytics-demo`:

```bash
pnpm run deploy --outputs-file cdk.out/outputs.json
```

Usa `pnpm run deploy`, no `pnpm deploy`. El [mapa de recursos](#mapa-de-recursos) describe lo que crea el stack. El deploy publica el asset Python; `demo:glue` lo copia a `GlueScriptLocation` antes de iniciar el ETL. La carga de la semilla y las ejecuciones de Glue y Athena ocurren después del deploy.

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

Desde `apps/cloud-analytics-demo`, después de `pnpm run deploy --outputs-file cdk.out/outputs.json`:

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

Ambos crawlers tienen seis targets de carpeta, uno por tabla, en `raw/<tabla>/` o `curated/<tabla>/`. `TableGroupingPolicy=CombineCompatibleSchemas` agrupa archivos compatibles dentro de cada target, sin fijar un nivel absoluto de tabla. Un clasificador CSV fija coma, comillas y cabecera `PRESENT`. Ambos crawlers usan `UPDATE_IN_DATABASE` para actualizar esquemas y `LOG` para borrados. El crawler curated excluye archivos auxiliares cuyo nombre empieza con `_` o `.`.

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

## Athena y datamart mínimo, prompt 03

Las consultas versionadas en [`athena/`](./athena/) usan nombres completos de la base `mercadoya_analytics_demo_curated`. El datamart consiste en estos resultados de lectura, sin nuevas tablas, vistas, bases ni capas en S3. Todas las consultas usan el workgroup `mercadoya-cloud-analytics-demo` del scaffold.

| Consulta                                                                  | Métrica y tablas curated                                                                                                                                               | Visualización en QuickSight, prompt 04                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`00_verify_curated.sql`](./athena/00_verify_curated.sql)                 | Filas y `$path` de `customers`, `products`, `orders`, `order_items`, `inventory_snapshots`, `payments`; detecta estados de pedidos sin normalizar                      | Tabla de control para explicar catálogo y Parquet                         |
| [`01_orders_by_month_status.sql`](./athena/01_orders_by_month_status.sql) | Número e importe de pedidos por mes, `status`, `channel` y moneda en `orders`                                                                                          | Barras apiladas de pedidos por mes y estado; filtro de canal              |
| [`02_revenue_by_segment.sql`](./athena/02_revenue_by_segment.sql)         | Suma de `orders.total_amount` por mes, `customers.segment`, `city` y moneda; join por `customer_id`                                                                    | Barras de ventas por segmento y filtro de ciudad                          |
| [`03_top_products.sql`](./athena/03_top_products.sql)                     | Top 10 por suma de `order_items.line_total`, unidades y pedidos; joins con `orders` y `products` por `order_id` y `product_id`; muestra categoría y precio de catálogo | Barras horizontales por producto y tabla con categoría, unidades y precio |

El mes usa el timestamp UTC del ETL. Las consultas abarcan todo el período disponible de la semilla, sin depender de la fecha de ejecución. Para acotar fechas, agrega un rango semiabierto, por ejemplo `order_date >= TIMESTAMP '2026-09-01 00:00:00' AND order_date < TIMESTAMP '2026-10-01 00:00:00'`, antes del `GROUP BY`. Usa `o.order_date` en las consultas con alias.

La consulta de pedidos incluye `confirmed`, `pending`, `rejected`, `cancelled`, `shipped` y `unknown`. Las dos consultas de ventas incluyen solo `confirmed` y `shipped`. Aquí "ventas" es el importe de esos pedidos, no una conciliación de cobros con `payments`. Cada métrica monetaria conserva su moneda como dimensión. Compara importes dentro de una misma moneda.

Los importes de origen usan `decimal(18,2)`. `SUM` y `AVG` operan sobre esos decimales, sin convertirlos a `double`. SQL ignora importes NULL en esas agregaciones y devuelve NULL si todo el grupo carece de importe. `orders_with_amount` e `items_with_amount` permiten explicar esa cobertura. Los grupos con mes NULL muestran fechas inválidas; ciudad, segmento y categoría ausentes llevan una etiqueta explícita.

La relación entre `orders` y `customers` es N:1 en la semilla. Por eso la consulta de segmento suma cada pedido una sola vez. En el top de productos se suman los importes históricos de las líneas; sumar `orders.total_amount` después del join con `order_items` duplicaría ventas. `products.price` muestra el precio actual del catálogo y no sustituye a `unit_price` ni a `line_total`. El total del ranking puede diferir del total de pedidos por los NULL deliberados de la semilla. El top mezcla grupos de monedas si se agregan datos distintos de PEN; filtra `o.currency` antes de compararlos en clase.

### Ejecutar desde la consola

1. Abre [Athena](https://console.aws.amazon.com/athena/) en la región del stack y entra al editor SQL.
2. Selecciona el workgroup `mercadoya-cloud-analytics-demo`, el catálogo `AwsDataCatalog` y la DB `mercadoya_analytics_demo_curated`.
3. Ejecuta `00_verify_curated.sql`. Deben aparecer las seis tablas con filas positivas, rutas `<CuratedLocation><tabla>/*.parquet` y `invalid_status_rows = 0`.
4. Ejecuta por separado las tres consultas analíticas. Puedes guardarlas en el editor; los archivos del repositorio son la fuente versionada.
5. En los detalles de cada consulta comprueba `SUCCEEDED` y una salida bajo `AthenaResultsLocation`, `s3://<ArtifactsBucketName>/athena-results/`. Descarga el CSV para revisar las métricas antes del prompt 04.

El workgroup impone ubicación, propietario y cifrado SSE-S3. No configures otro bucket ni habilites resultados administrados por Athena para este demo. El flujo de [QuickSight desde consola](./RUNBOOK.md#quicksight-en-consola) quedó completado el 1 de octubre de 2026: tres datasets Athena en Direct Query, tres gráficos y tabla auxiliar, analysis guardado y [dashboard publicado para clase](https://us-east-1.quicksight.aws.amazon.com/sn/account/rodrigoperez/dashboards/6e54098a-34ed-4cfe-92f8-0d968cff2822). Ventas considera confirmed/shipped; selección inicial PEN y ranking filtrado por PEN antes de LIMIT. El runbook registra enlaces/IDs, mapa de campos, filtros, actualización tras ETL y comprobaciones. Los [pasos manuales del docente](./RUNBOOK.md#pasos-manuales-del-docente) se conservan para repetir las acciones de cuenta; esta sesión se ejecutó con Helium y permisos S3 confirmados por Rodrigo.

### Ejecutar y guardar evidencia desde CLI

Después de desplegar y terminar `pnpm demo:glue`, desde `apps/cloud-analytics-demo`:

```bash
pnpm demo:athena cdk.out/outputs.json
# Sin archivo, lee los outputs del stack ya desplegado en CloudFormation:
CDK_DEFAULT_REGION=us-east-1 pnpm demo:athena
```

`demo:athena` usa `AWS_PROFILE` si está definido. Sin archivo de outputs, la región se obtiene de `CDK_DEFAULT_REGION`, `AWS_REGION`, `AWS_DEFAULT_REGION` o, por defecto, `us-east-1`. Con archivo, usa `Region` del despliegue. Comprueba la cuenta activa, la configuración del workgroup y las seis tablas del catálogo curated, incluidas sus ubicaciones, clasificación Parquet y tipos de las columnas consultadas. No lee el catálogo raw ni inicia Glue.

El comando ejecuta las cuatro consultas sin reutilizar resultados anteriores. Exige `SUCCEEDED` y filas para cada una, valida las rutas `$path` y los estados normalizados, comprueba la ubicación de salida y confirma con `HeadObject` que el CSV existe en S3. Imprime una muestra de cada resultado y guarda IDs, SQL, filas, esquemas, rutas S3, estadísticas y fecha en `cdk.out/athena-demo-evidence.json`. El archivo está ignorado por Git y solo se escribe al completar todas las comprobaciones. Revisa `verifiedAt` para distinguir una ejecución anterior. Si una consulta falla o supera cinco minutos, el comando muestra su ID; inspecciona su estado en Athena antes de repetir.

Opcionalmente adjunta el output `AthenaQueryPolicyArn` a la identidad existente del docente mediante IAM o su permission set de Identity Center. La política ya permite consultar este workgroup, leer las tablas y objetos curated y escribir/leer `athena-results/*`. Las consultas usan los permisos de esa identidad. La lectura opcional de outputs desde CloudFormation requiere `cloudformation:DescribeStacks`; puedes pasar `cdk.out/outputs.json` para evitar ese permiso. La consola puede necesitar permisos adicionales para listar workgroups o bases. La política no se adjunta automáticamente ni cambia con este prompt.

Las pruebas `pnpm test` simulan las respuestas AWS para comprobar que el comando rechaza catálogo raw, importes no decimales, resultados fuera del prefijo, tablas vacías, estados inválidos y consultas fallidas. La evidencia de ejecución en AWS se obtiene con `demo:athena` y se resume en [`athena/validation.md`](./athena/validation.md).

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

Sigue el [teardown del runbook](./RUNBOOK.md#teardown). Incluye terminar ejecuciones, desadjuntar la política Athena de identidades externas, retirar los recursos de QuickSight creados para la clase, vaciar `athena-results/`, raw, curated, temporales y scripts, y luego ejecutar `pnpm destroy` desde este app.

Los buckets usan `RemovalPolicy.DESTROY` y deben estar vacíos. El workgroup, su historial y las dos DB salen con el stack. Conserva el toolkit de bootstrap y el grupo compartido `/aws-glue/crawlers`.

## Documentación AWS consultada

Referencias oficiales consultadas para el scaffold y este cambio, el 1 de octubre de 2026. El [runbook](./RUNBOOK.md) incluye las referencias de CDK deploy, bootstrap, ejecución de Glue y configuración actual de QuickSight. Se contrastaron las propiedades de crawlers, job y asset con CDK 2.270.0 instalado:

- [CDK synth](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-synth.html) y [S3 Bucket en CDK v2](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3.Bucket.html), síntesis, cifrado, HTTPS y eliminación.
- [Ejemplos IAM de Glue](https://docs.aws.amazon.com/glue/latest/dg/security_iam_id-based-policy-examples.html) y [prerrequisitos del crawler](https://docs.aws.amazon.com/glue/latest/dg/crawler-prereqs.html), confianza del servicio, permisos S3 y ARNs de catálogo, base y tabla.
- [Acceso de Athena al Data Catalog](https://docs.aws.amazon.com/athena/latest/ug/fine-grained-access-to-glue-resources.html), permisos de tablas y sus recursos antecesores.
- [Políticas del workgroup](https://docs.aws.amazon.com/athena/latest/ug/example-policies-workgroup.html) y [override de configuración](https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html), consultas restringidas al workgroup y salida obligatoria.
- [Gestión de workgroups](https://docs.aws.amazon.com/athena/latest/ug/workgroups-create-update-delete.html), selección del workgroup en consola; [resultados de consultas](https://docs.aws.amazon.com/athena/latest/ug/querying.html), salida S3 y permisos para leerla; [IAM de Athena](https://docs.aws.amazon.com/athena/latest/ug/security-iam-athena.html), acceso de la identidad a Athena, S3 y Glue. Verificadas para el prompt 03 el 1 de octubre de 2026.
- [Acceso S3 desde Athena](https://docs.aws.amazon.com/athena/latest/ug/s3-permissions.html), permisos de la identidad que consulta; [permisos S3 de Athena](https://docs.aws.amazon.com/athena/latest/ug/cross-account-permissions.html) y [uploads multipart de S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), acciones de bucket y objeto.
- [Logs de Glue 5.0](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuous-logging.html) y [logs del crawler](https://docs.aws.amazon.com/glue/latest/dg/troubleshooting-contact-support.html), ubicaciones y configuración del job.
- [CfnCrawlerProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnCrawlerProps.html) y [agrupación por target S3](https://docs.aws.amazon.com/glue/latest/dg/crawler-grouping-policy.html), carpetas por tabla y `CombineCompatibleSchemas`. El despliegue real rechazó el nivel absoluto 2 anterior; la configuración actual no fija `TableLevelConfiguration`.
- [SchemaChangePolicy](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnCrawler.SchemaChangePolicyProperty.html), valores `UPDATE_IN_DATABASE` y `LOG`.
- [Clasificador CSV en CDK](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnClassifier.CsvClassifierProperty.html) y [clasificadores CSV de Glue](https://docs.aws.amazon.com/glue/latest/dg/add-classifier.html), cabeceras y delimitadores.
- [CfnJobProps](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_glue.CfnJobProps.html) y [versiones de Glue](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html), Glue 5.0 con Spark 3.5.4, workers y argumentos.
- [Bookmarks de Glue](https://docs.aws.amazon.com/glue/latest/dg/monitor-continuations.html), `job-bookmark-disable` para procesar siempre la semilla completa.
- [Assets S3 de CDK](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_assets.Asset.html), empaquetado y ubicación del script publicado.

La validación local incluye typecheck, synth, pruebas de plantilla y pruebas Spark con las seis CSV. Para el prompt 03, consulta la evidencia de ejecución de Glue y Athena en [`athena/validation.md`](./athena/validation.md).
