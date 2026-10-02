# Despliegue y runbook de demostración

Recorrido de la Sesión 6, con el stack de los prompts 01 a 03. Reserva 10 a 20 minutos de relato para raw, catálogo, Parquet, SQL y visualización. Haz el deploy, la primera ejecución de Glue y la preparación de QuickSight antes de clase. Las esperas de AWS pueden alargar una ejecución en vivo.

## Preparar la sesión docente

Necesitas Node según [`.node-version`](../../.node-version), pnpm según [`package.json`](../../package.json), AWS CLI v2 y credenciales de la cuenta docente. Instala las dependencias desde la raíz del repositorio con `pnpm install`. La identidad debe poder desplegar con CDK, publicar y leer assets del bootstrap, cargar raw y scripts, ejecutar Glue y consultar Athena. Incluye `iam:PassRole` sobre los dos roles de Glue. El [README](./README.md#permisos-iam-y-extensiones) detalla esos permisos.

Desde la raíz, selecciona tu perfil y entra al app. Sustituye el perfil y la región si corresponde:

```bash
export AWS_PROFILE="<perfil-docente>"
aws sso login --profile "$AWS_PROFILE" # Solo si el perfil usa SSO.
cd apps/cloud-analytics-demo
export CDK_DEFAULT_REGION="us-east-1"
export AWS_REGION="$CDK_DEFAULT_REGION"
export AWS_PAGER=""
aws sts get-caller-identity
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
```

Confirma la cuenta docente antes de seguir. Usa una sola instancia de `CloudAnalyticsDemoStack` por cuenta y región, pues los nombres de bases, crawlers, job y workgroup son fijos.

### Ruta A: stack ya desplegado

Parte de `cdk.out/outputs.json` del despliegue docente. La [validación del prompt 03](./athena/validation.md) registró `CREATE_COMPLETE` en la cuenta docente; confirma el estado actual:

```bash
aws cloudformation describe-stacks --stack-name CloudAnalyticsDemoStack \
  --region "$CDK_DEFAULT_REGION" --query 'Stacks[0].StackStatus' --output text
```

Debe ser `CREATE_COMPLETE`, o `UPDATE_COMPLETE` si hubo una actualización posterior. Si faltan los outputs o corresponden a otra sesión, regénéralos desde CloudFormation, sin redesplegar. Este comando requiere `cloudformation:DescribeStacks` y conserva el formato que leen ambos scripts:

```bash
mkdir -p cdk.out
aws cloudformation describe-stacks --stack-name CloudAnalyticsDemoStack \
  --region "$CDK_DEFAULT_REGION" --output json \
  | node --input-type=module -e '
import { readFileSync } from "node:fs";
const stack = JSON.parse(readFileSync(0, "utf8")).Stacks[0];
if (!["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus)) {
  throw new Error(`Stack no disponible: ${stack.StackStatus}`);
}
const outputs = Object.fromEntries(stack.Outputs.map(o => [o.OutputKey, o.OutputValue]));
console.log(JSON.stringify({ CloudAnalyticsDemoStack: outputs }, null, 2));
' > cdk.out/outputs.json
```

Continúa en "Cargar los outputs" y luego en el recorrido operativo.

### Ruta B: deploy fresco

Comprueba que la cuenta y región no contienen otra instancia con los nombres fijos. Si el entorno aún no tiene bootstrap de CDK, ejecútalo una vez. Este scaffold lo necesita para publicar el asset Python. El toolkit es compartido y queda fuera del teardown del demo. Consulta [bootstrap de CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html).

```bash
# Solo si falta bootstrap en esta cuenta y región:
pnpm bootstrap "aws://${CDK_DEFAULT_ACCOUNT}/${CDK_DEFAULT_REGION}"
```

Desde `apps/cloud-analytics-demo`, revisa el diff y despliega:

```bash
pnpm cdk diff
pnpm run deploy --outputs-file cdk.out/outputs.json
aws cloudformation describe-stacks --stack-name CloudAnalyticsDemoStack \
  --region "$CDK_DEFAULT_REGION" --query 'Stacks[0].StackStatus' --output text
```

Espera `CREATE_COMPLETE` antes del recorrido. Usa `pnpm run deploy`. `pnpm deploy` es otro comando de pnpm. CDK escribe los outputs en el archivo indicado, organizados por stack, según [CDK deploy](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-deploy.html).

El deploy crea tres buckets S3, raw, curated y artefactos, dos roles de ejecución de Glue, dos bases del Data Catalog, un clasificador CSV, los crawlers raw y curated, el job ETL Glue 5.0 con dos workers G.1X y dos grupos de logs con retención de siete días. También crea el workgroup Athena `mercadoya-cloud-analytics-demo`, engine v3, y la política administrada `AthenaQueryPolicyArn`, inicialmente sin adjuntar. Los buckets usan SSE-S3, HTTPS y bloqueo de acceso público. El [mapa de recursos](./README.md#mapa-de-recursos) contiene los outputs.

CDK publica el script como asset en el bucket del toolkit. El deploy no carga la semilla ni ejecuta crawlers, job o consultas. QuickSight se configura desde consola.

### Cargar los outputs

Ejecuta este bloque en la misma terminal después de cualquiera de las dos rutas. La función evita copiar nombres de buckets a mano:

```bash
output() {
  node --input-type=commonjs -e '
const outputs = require("./cdk.out/outputs.json").CloudAnalyticsDemoStack;
const value = outputs?.[process.argv[1]];
if (!value) throw new Error(`Falta output ${process.argv[1]}`);
console.log(value);
' "$1"
}
export CDK_DEFAULT_REGION="$(output Region)"
export AWS_REGION="$CDK_DEFAULT_REGION"
export CDK_DEFAULT_ACCOUNT="$(output AccountId)"
test "$(aws sts get-caller-identity --query Account --output text)" = "$CDK_DEFAULT_ACCOUNT"
export RAW_LOCATION="$(output RawLocation)"
export CURATED_LOCATION="$(output CuratedLocation)"
export ARTIFACTS_BUCKET="$(output ArtifactsBucketName)"
```

Si la comprobación de cuenta falla, detén el recorrido y selecciona la sesión correcta. Opcionalmente, en IAM adjunta `AthenaQueryPolicyArn`, obtenido con `output AthenaQueryPolicyArn`, al usuario o rol existente del docente. Para Identity Center, agrégalo al permission set y provisiona la cuenta. Esta política permite consultar curated y usar `athena-results/`; ejecutar Glue y navegar por listas de consola requiere los permisos adicionales del README. No crees un rol Athena: las consultas usan los permisos de la identidad que las inicia.

## Recorrido en vivo

Para ensayar, ejecuta los scripts en este orden, esperando que cada comando termine con éxito:

```bash
pnpm demo:glue cdk.out/outputs.json
pnpm demo:athena cdk.out/outputs.json
```

`demo:glue` copia el asset al bucket de artefactos, carga las seis CSV, corre raw, ETL y curated, y valida conteos en Athena. Sobrescribe raw y curated. `demo:athena` verifica el catálogo curated y ejecuta los cuatro SQL. Guarda evidencia local en `cdk.out/glue-demo-evidence.json` y `cdk.out/athena-demo-evidence.json`. No versiones `cdk.out/*`. La evidencia histórica opcional está en [`athena/validation.md`](./athena/validation.md).

Durante clase puedes mostrar el resultado del ensayo o ejecutar las etapas a mano con los pasos siguientes. Elige un modo; no inicies crawlers o jobs manuales mientras `demo:glue` esté ejecutándose.

1. **Semilla raw, 2 minutos.** Explica que son CSV sintéticas con cabecera. Carga los seis archivos y muestra `orders/orders.csv` en S3:

   ```bash
   for file in seed/raw/*.csv; do
     table="$(basename "$file" .csv)"
     aws s3 cp "$file" "${RAW_LOCATION}${table}/${table}.csv" --region "$CDK_DEFAULT_REGION"
   done
   aws s3 ls "$RAW_LOCATION" --recursive --region "$CDK_DEFAULT_REGION"
   ```

   Deben existir `raw/<tabla>/<tabla>.csv` para `customers`, `products`, `orders`, `order_items`, `inventory_snapshots` y `payments`.

2. **Crawler raw, 2 minutos.** En Glue muestra `mercadoya-cloud-analytics-demo-raw` y sus seis targets de carpeta `raw/<tabla>/`. Comprueba la configuración antes de arrancar:

   ```bash
   aws glue get-crawler --name mercadoya-cloud-analytics-demo-raw \
     --region "$CDK_DEFAULT_REGION" --query 'Crawler.{Targets:Targets.S3Targets,Configuration:Configuration}'
   aws glue start-crawler --name mercadoya-cloud-analytics-demo-raw --region "$CDK_DEFAULT_REGION"
   aws glue get-crawler --name mercadoya-cloud-analytics-demo-raw \
     --region "$CDK_DEFAULT_REGION" --query 'Crawler.{State:State,LastCrawl:LastCrawl}'
   ```

   Repite `get-crawler` hasta `State=READY` y `LastCrawl.Status=SUCCEEDED` de esta ejecución, comprobando `StartTime`. El crawler crea metadata, no transforma los CSV. Usa `TableGroupingPolicy=CombineCompatibleSchemas`, sin `TableLevelConfiguration=2` y sin targets al archivo CSV. Consulta la [agrupación por include path de Glue](https://docs.aws.amazon.com/glue/latest/dg/crawler-grouping-policy.html).

3. **Job ETL, 3 minutos.** Si estás mostrando el ensayo con `demo:glue`, abre su ejecución en Glue y los logs. Para la ejecución manual, primero copia el script publicado y captura el ID del run:

   ```bash
   aws s3 cp "$(output GlueScriptAssetLocation)" "$(output GlueScriptLocation)" --region "$CDK_DEFAULT_REGION"
   JOB_RUN_ID="$(aws glue start-job-run --job-name mercadoya-cloud-analytics-demo-etl \
     --region "$CDK_DEFAULT_REGION" --query JobRunId --output text)"
   aws glue get-job-run --job-name mercadoya-cloud-analytics-demo-etl --run-id "$JOB_RUN_ID" \
     --region "$CDK_DEFAULT_REGION" --query 'JobRun.{State:JobRunState,Error:ErrorMessage}'
   ```

   Repite `get-job-run` hasta `SUCCEEDED`. Desde consola, Glue, ETL jobs, selecciona el job y pulsa **Run**, luego revisa **Runs**. La copia previa del script también es necesaria al usar consola por primera vez. Explica la conversión de tipos y la escritura Parquet Snappy en `curated/<tabla>/`. El job lee CSV desde S3; no depende de las tablas raw ni actualiza el catálogo. Consulta [StartJobRun](https://docs.aws.amazon.com/cli/latest/reference/glue/start-job-run.html).

4. **Crawler curated, 2 minutos.** Solo después de `SUCCEEDED`, registra los Parquet:

   ```bash
   aws s3 ls "$CURATED_LOCATION" --recursive --region "$CDK_DEFAULT_REGION"
   aws glue start-crawler --name mercadoya-cloud-analytics-demo-curated --region "$CDK_DEFAULT_REGION"
   aws glue get-crawler --name mercadoya-cloud-analytics-demo-curated \
     --region "$CDK_DEFAULT_REGION" --query 'Crawler.{State:State,LastCrawl:LastCrawl}'
   aws glue get-tables --database-name mercadoya_analytics_demo_curated \
     --region "$CDK_DEFAULT_REGION" --query 'TableList[].{Table:Name,Location:StorageDescriptor.Location}'
   ```

   Repite `get-crawler` hasta `READY` y `SUCCEEDED` del crawl actual antes de `get-tables`. Deben aparecer exactamente las seis tablas del paso 1 en `mercadoya_analytics_demo_curated`, con ubicaciones `curated/<tabla>/` y clasificación Parquet. En consola abre `orders` y muestra `order_date:timestamp` y `total_amount:decimal(18,2)`.

5. **Athena, 3 minutos.** Abre el editor en la región del stack. Selecciona workgroup `mercadoya-cloud-analytics-demo`, catálogo `AwsDataCatalog` y DB `mercadoya_analytics_demo_curated`. `00_verify_curated.sql` es el control de filas, `$path` y estados. En clase, prioriza `01`, `02` o `03` de [`athena/`](./athena/) para explicar una métrica. El [README, Athena y datamart mínimo](./README.md#athena-y-datamart-mínimo-prompt-03) describe sus joins y filtros.

   Para comprobar todos los SQL desde CLI, ejecuta `pnpm demo:athena cdk.out/outputs.json` después de completar Glue. En los detalles de consulta confirma `SUCCEEDED` y resultados en `s3://<ArtifactsBucket>/athena-results/`. El workgroup impone ese prefijo y SSE-S3 según el [override de configuración de Athena](https://docs.aws.amazon.com/athena/latest/ug/workgroups-settings-override.html). No habilites resultados administrados ni cambies de bucket para esta demo.

6. **QuickSight desde consola, 4 minutos.** Prepara la cuenta y los permisos antes de clase según el bloque siguiente. Crea un dataset Athena sobre curated con el SQL elegido y muestra su visual. No hace falta importar el CSV de resultados de Athena ni crear vistas nuevas.

## QuickSight en consola

Amazon Quick / Quick Sight ya está habilitado en la cuenta docente y Rodrigo tiene un Author activo. No iniciar signup, registro, trial ni activación. Esta guía registra la capa de BI del prompt 05 completada desde consola y permite repetir el flujo.

### Fuente y datasets creados

Reutiliza el perfil de conexión Athena existente para el workgroup del demo. El perfil guarda el workgroup, pero no fija la base ni la tabla. Selecciona curated en cada dataset. Si no existe el perfil, usa el nombre `mercadoya-athena-curated` para el nuevo perfil de conexión, sin crear infraestructura adicional.

| Configuración                           | Valor de esta sesión                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Cuenta y región                         | `902311297707`, `us-east-1`                                                         |
| Workgroup, output `AthenaWorkGroupName` | `mercadoya-cloud-analytics-demo`                                                    |
| Catálogo                                | `AwsDataCatalog`                                                                    |
| Base, output `CuratedDatabaseName`      | `mercadoya_analytics_demo_curated`                                                  |
| `CuratedBucketName`                     | `cloudanalyticsdemostack-curatedbucket6a59c97e-jhpqxorwpo3i`                        |
| `ArtifactsBucketName`                   | `cloudanalyticsdemostack-artifactsbucket2aac5544-bvme6cvpbkpl`                      |
| `AthenaResultsLocation`                 | `s3://cloudanalyticsdemostack-artifactsbucket2aac5544-bvme6cvpbkpl/athena-results/` |

Estos valores proceden de `cdk.out/outputs.json` y la [validación de Athena](./athena/validation.md). Si cambió el despliegue, usa sus outputs actuales. No selecciones la base raw ni importes los CSV de resultados de Athena.

Usa un dataset por consulta, todos con la misma conexión. No unas entre sí los resultados agregados: tienen granularidades distintas y un join multiplicaría medidas.

| Dataset creado                         | Custom SQL versionado                                                     | Una fila representa                                       |
| -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `mercadoya-pedidos-mes-estado-curated` | [`01_orders_by_month_status.sql`](./athena/01_orders_by_month_status.sql) | Mes, estado, canal y moneda                               |
| `mercadoya-ventas-segmento-curated`    | [`02_revenue_by_segment.sql`](./athena/02_revenue_by_segment.sql)         | Mes, segmento, ciudad y moneda                            |
| `mercadoya-top-productos-curated`      | [`03_top_products.sql`](./athena/03_top_products.sql)                     | Producto y monedas de catálogo y venta, dentro del top 10 |

Pega el `SELECT` completo en **Use custom SQL**, quitando el punto y coma final para que pueda envolverse como subconsulta. Conserva los joins y nombres completos de curated. En **Edit/preview data**, comprueba `month` como fecha, las etiquetas como texto y las medidas como números. Conserva los importes decimales; no agregues un join visual con raw.

### Recorrido de consola hasta el dashboard final

1. Abrir Amazon Quick en Helium con la sesión docente existente y región `us-east-1`. La primera validación Athena falló con `GENERIC_SQL_EXCEPTION`, porque Athena no podía verificar o crear el bucket de salida. No se creó otro bucket ni workgroup para resolverlo.
2. Abrir el menú del usuario, **Manage account**, **AWS resources**. Athena ya estaba habilitado. En S3 seleccionar lectura del bucket curated y lectura/escritura del bucket de artefactos, incluida **Write permission for Athena Workgroup**. Dejar raw sin seleccionar. Pulsar **Finish**, revisar el alcance y, después de la confirmación expresa de Rodrigo, **Save**. En otras versiones de consola esta configuración aparece como **Security & permissions**, **Add or remove**.
3. Crear el perfil Athena `mercadoya-athena-curated`, elegir `mercadoya-cloud-analytics-demo` y ejecutar **Validate connection**. La consola mostró la conexión validada después de guardar los permisos anteriores. Reutilizar este perfil para los tres datasets.
4. Crear primero `mercadoya-ventas-segmento-curated` con **Use custom SQL** y el SELECT de `02`, sin punto y coma final. Seleccionar `AwsDataCatalog` y `mercadoya_analytics_demo_curated`. En la preparación de datos cambiar el modo inicial SPICE a **Direct query** y revisar las 180 filas del preview. En **Save & publish**, elegir **Publish & visualize** para crear el analysis.
5. Desde la misma fuente crear pedidos con `01` y productos con `03`. En productos añadir `AND o.currency = 'PEN'` antes del GROUP BY y LIMIT. En **Finish dataset creation**, elegir **Directly query your data**, abrir **Edit/Preview data** y guardar cada dataset con **Save & publish**, sin crear otro analysis.
6. En el analysis abrir el selector de dataset, **Manage data**, **Add data**, y añadir pedidos y productos. Crear las hojas interactivas **Ventas por segmento**, **Pedidos por mes y estado** y **Top productos en PEN**, con layout **Tiled**, optimizado para **1600px**. Seleccionar el dataset correspondiente antes de añadir los campos. Usar el mapa de la siguiente sección para configurar los tres gráficos y la tabla.
7. En cada visual abrir **Format visual**, **Display Settings** para editar título y subtítulo. En pedidos elegir barras apiladas verticales y cambiar la agregación de `month` de Day a **Month**. En la tabla cambiar `catalog_price` de Sum a **Max**, ocultar `product_id` y `sales_currency` desde **Hide**, y usar **Sort visual**, `product_sales_amount`, **Descending**, **Apply sort**. Las dimensiones ocultas siguen en la agrupación.
8. Añadir filtros desde **Filter**, **Add** y exponerlos mediante el menú del filtro, **Add control**, **Top of this sheet**. En ventas configurar moneda como **Dropdown** de selección única, ocultar **Select all**, titular el control **Moneda de venta** y seleccionar PEN. Ciudad empieza en All. El rango de mes empieza en 2026/07/01 inclusive y termina en 2026/10/01 exclusive. En pedidos añadir `channel` con All al inicio. Estos filtros afectan a su hoja o visual, sin aplicación cruzada a los otros datasets.
9. Renombrar el analysis y comprobar **Autosave On**. Reabrirlo para verificar que los nombres, agregaciones y modo de los datasets persistieron. Elegir **Publish**, **New dashboard**, escribir el nombre documentado y seleccionar **All sheets**. Añadir la nota de versión sobre curated, confirmed/shipped, PEN y UTC. Desmarcar **Allow executive summary**, **Allow sharing stories** y **Allow sharing scenarios**; conservar Quick actions y Q&A desactivados. Pulsar **Publish dashboard** sin añadir usuarios.
10. Abrir las tres hojas publicadas y probar ciudad Lima y canal web. Restaurar mediante **Reset to original** después de las pruebas. La revisión detectó que la tabla dedicaba demasiado ancho al UUID y a la moneda fija de venta; se ocultaron esas columnas y se aplicó el orden descendente en el analysis. Publicar otra vez con **Replace existing dashboard**, seleccionando exclusivamente el dashboard creado en esta sesión. Comprobar que la tabla final muestra las diez filas con título, categoría, moneda de catálogo, ventas, unidades y precio, y restaurar la vista original.

Las notas de versión quedan visibles para los propietarios en **Version history**. Los títulos y subtítulos de los gráficos llevan el contexto de negocio para la vista de lectura. No se importaron CSV ni se cambiaron los SQL versionados, los recursos base o el datamart.

### Modo de consulta y actualización

La decisión para esta demo es **Direct Query**, mediante **Directly query your data** o **Query**. Consulta Athena al abrir el dataset, analysis o dashboard y evita mantener una copia SPICE después del ETL. El modo quedó guardado en los tres datasets y se comprobó de nuevo al reabrir el de ventas. Las consultas e interacciones generan consumo en el workgroup.

Después de repetir el ETL, espera el job `SUCCEEDED` y el crawler curated `READY` con el crawl actual `SUCCEEDED`. Ejecuta `pnpm demo:athena cdk.out/outputs.json` y vuelve a abrir o recarga el analysis/dashboard para consultar los nuevos datos. Los controles de filtro se actualizan automáticamente cada 24 horas; comprueba sus valores si añadiste meses o ciudades. Un cambio de esquema requiere revisar los tipos y guardar el dataset.

SPICE queda como alternativa para una clase que necesite una copia con menor latencia. Los resultados verificados tienen 54, 180 y 10 filas, pero eso no demuestra capacidad SPICE disponible. Antes de elegirlo, comprueba el indicador de capacidad, registra capacidad y modo en la evidencia y espera importación `COMPLETED`, sin filas omitidas. Después de cada ETL, abre **Data**, el dataset, **Refresh**, **Refresh now**, **Full refresh**, **Refresh** y espera `COMPLETED` en los datasets utilizados. El ETL sobrescribe curated; usa actualización completa. No compres capacidad ni actives Pro para este demo.

Este recorrido usa IAM del scaffold. Si la conexión real usa propagación de identidad con Lake Formation, revisa con el administrador sus restricciones de Custom SQL y SPICE antes de seguir esta receta.

### Mapa de campos, filtros y relato

Crea un solo analysis con tres hojas interactivas, una por dataset, para que cada control afecte solo a sus visuales. Añade los demás datasets al mismo analysis cuando completes la ruta ampliada. Si solo hay tiempo para una visual, usa ventas por segmento y publica únicamente esa hoja.

| Hoja y título de visual                                                                  | Tipo y campos                                                                                                                                                             | Filtros y orden                                                                                                                                         | Pregunta de negocio                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Pedidos: `Pedidos por mes y estado`                                                      | Barras apiladas verticales; X = `month` con granularidad mes; Group/Color = `status`; Value = `SUM(order_count)`                                                          | Control `channel`, todos al inicio; mes ascendente                                                                                                      | ¿Cómo cambia el volumen y qué parte queda pendiente, rechazada o cancelada?     |
| Ventas: `Ventas por segmento en PEN`                                                     | Barras horizontales; Y = `segment`; Value = `SUM(sales_amount)`                                                                                                           | Control `month`: desde 2026-07-01 inclusive hasta 2026-10-01 exclusive; `city`: todos al inicio; `currency = PEN`, selección única; ventas descendentes | ¿Qué segmentos concentran ventas y cómo cambia la comparación por mes o ciudad? |
| Productos: `Top 10 productos por ventas en PEN`                                          | Barras horizontales; Y = `title`; Value = `SUM(product_sales_amount)`                                                                                                     | `sales_currency = PEN`; ventas descendentes                                                                                                             | ¿Qué productos concentran el importe de líneas vendidas?                        |
| Tabla auxiliar de Productos: `Detalle del top 10: ventas, unidades y precio de catalogo` | Tabla; dimensiones `product_id`, `title`, `category`, `sales_currency`, `catalog_currency`; valores `SUM(product_sales_amount)`, `SUM(units_sold)` y `MAX(catalog_price)` | `o.currency = PEN` en el SQL antes de LIMIT, compartido con la barra; ventas descendentes                                                               | ¿El importe procede de más unidades o de productos con mayor precio?            |

En **Visualize**, **Add**, **Add visual**, elige el tipo de barras indicado y arrastra los campos a sus field wells. Selecciona explícitamente **Sum** en las medidas agregadas: contar filas de `01` contaría grupos SQL, no pedidos. En la tabla, `MAX(catalog_price)` conserva el precio; no sumes precios. Usa cero decimales en pedidos y unidades, dos en importes y muestra la moneda en títulos o columnas. El precio actual tiene `catalog_currency`, que puede diferir de `sales_currency`.

En el panel de filtros, añade cada campo, configura el alcance a las visuales de su hoja y agrega controles visibles. En Productos el SQL fija PEN antes de calcular el ranking, por lo que esa condición se aplica tanto a la barra como a la tabla. `product_id` y `sales_currency` quedan como dimensiones ocultas en la tabla para dar espacio a las medidas, sin cambiar la agrupación; pueden mostrarse desde sus opciones. No supongas que un control de un dataset filtra los otros. Si cambias de moneda, actualiza también los títulos que dicen PEN. Los controles de ventas cubren el trimestre de la semilla y excluyen meses NULL. Si el ETL añade otros meses, amplía ese rango; si necesitas explicar fechas faltantes, cambia también el tratamiento de NULL. Las etiquetas de segmento, ciudad y categoría faltantes se conservan.

`01` incluye todos los estados normalizados. `02` y `03` incluyen solo pedidos `confirmed` y `shipped`; sus ventas no representan cobros conciliados con `payments`. Los meses usan UTC. `02` suma totales de pedidos; `03` suma importes históricos de líneas, por lo que sus totales pueden diferir por datos faltantes. El top 10 tampoco representa el total del catálogo.

`03` aplica `LIMIT 10` antes de los filtros de Quick Sight. La semilla verificada es PEN. El Custom SQL guardado ya añade `AND o.currency = 'PEN'` al `WHERE` de `03`, antes del `GROUP BY`; los SQL versionados permanecen intactos. Filtrar `sales_currency` después del top global puede dejar menos de diez productos y no calcula el top de PEN. Registra esa variante en la evidencia. No añadas controles de mes o ciudad al ranking fijo. Si aparecen títulos repetidos, distingue los productos por `product_id` para evitar agruparlos en la misma barra.

### Nombre, descripción y publicación

Nombre del analysis guardado: `MercadoYa | Athena curated | pedidos y ventas confirmed/shipped por moneda`. Nombre del dashboard publicado: `MercadoYa | Clase BI | ventas confirmed/shipped en PEN`. Ajusta los nombres si solo publicas una hoja.

Usa esta descripción en los objetos que ofrezcan ese campo y como texto visible en las hojas publicadas:

> Datos de Athena curated en us-east-1. Pedidos por mes y estado. Las ventas por segmento y producto consideran solo pedidos confirmed/shipped, no cobros conciliados. Comparar importes dentro de la misma moneda; selección inicial PEN. Meses en UTC. El ranking muestra diez productos del período completo; el precio de catálogo no es el precio histórico de venta.

Comprueba que el analysis aparece guardado y que puede reabrirse. Para repetir la publicación usa **Publish**, **New dashboard**, selecciona las hojas interactivas terminadas y elige **Publish dashboard**. Solo puede reemplazar un dashboard creado para esta sesión. Si aparece el diálogo de compartir, ciérralo sin añadir usuarios. Después abre el dashboard publicado, prueba los controles y comprueba etiquetas, agregaciones y moneda como se mostrarán al alumnado. Los cambios de diseño del analysis necesitan republicación; una nueva ejecución del ETL requiere la actualización del modo elegido.

### Pasos manuales del docente

Se conserva esta guía para repetir el flujo y distinguir las acciones de cuenta de la preparación del repositorio. En esta sesión Rodrigo pidió ejecutar el flujo con Helium y confirmó expresamente guardar los permisos S3. El agente completó los clics de creación, guardado y publicación bajo esa autorización. Cualquier nuevo consentimiento legal o ampliación de acceso requiere confirmación en el momento de aplicarlo.

1. Entrar en la **misma cuenta AWS** y en `us-east-1`; confirmar que Amazon Quick / Quick Sight ya está habilitado y que Rodrigo aparece como **Author**. No abrir ningún flujo de signup, alta o registro.
2. Si faltan permisos de administrador, en **Manage QuickSight**, **Security & permissions**, **Add or remove**, habilitar Athena y autorizar únicamente `CuratedBucketName` y `ArtifactsBucketName`, para leer curated y leer/escribir `athena-results/`. No autorizar raw por defecto. Activar la escritura para el workgroup si la consola la solicita y guardar con **Finish**, **Save**, o **Update** según la versión de consola. Si la configuración real muestra KMS, conceder el decrypt necesario. El stack usa SSE-S3, pero se debe comprobar el cifrado actual. Adjuntar la política Athena al docente no concede permisos al servicio Quick Sight. Un `AccessDenied` que requiera administrador queda a cargo de Rodrigo.
3. En **Data**, **Create**, **New dataset**, elegir la fuente Athena existente o crear el perfil con el workgroup `mercadoya-cloud-analytics-demo`; ejecutar **Validate connection** y aceptar cualquier consentimiento/confirmación de primera conexión. Rodrigo debe revisar cualquier consentimiento o ampliación de permisos que aparezca; en esta sesión la validación pasó después de guardar los permisos S3 confirmados, sin un consentimiento adicional.
4. Seleccionar `AwsDataCatalog` y `mercadoya_analytics_demo_curated`, y cargar una de las consultas previstas. Elegir Direct Query según la decisión documentada, o registrar el cambio a SPICE y esperar la importación si corresponde.
5. Abrir **Visualize**, crear las visuales del mapa, revisar títulos, agregaciones, moneda y filtros, y guardar el analysis. Confirmar que los resultados son interpretables y que ninguna visual apunta a raw.
6. En el analysis elegir **Publish**, **Publish dashboard**, publicar como dashboard nuevo o reemplazar solo uno creado para esta sesión, seleccionar las hojas necesarias y comprobarlo como lo verá el alumnado. No activar Q&A/Quick generativo ni compartir con usuarios adicionales salvo requisito explícito de la clase.

### Verificación y evidencia de cierre

Flujo completado desde Helium el 1 de octubre de 2026 en la cuenta docente existente. La conexión Athena se validó después de la confirmación de Rodrigo: lectura de curated y lectura/escritura del bucket de artefactos para el workgroup; raw quedó sin seleccionar. La pantalla de permisos concede acceso a esos buckets, no una restricción nueva por prefijo; Athena sigue imponiendo `athena-results/` como salida. No hubo alta, nuevos usuarios, Pro ni Q&A. Al publicar se desmarcaron resumen ejecutivo, stories, scenarios y Quick actions. No se compartió con otros usuarios.

La [evidencia de Athena](./athena/validation.md) registra seis tablas con filas y los resultados de `01`, `02` y `03`. Como referencia de esa semilla, `SUM(order_count)` de `01` sin filtros es 3.500; `SUM(sales_amount)` de `02` en PEN sin filtros de mes o ciudad es S/ 6.790.760,56. El primer producto de `03` es `Max Filtro 197`, con S/ 455.935,54, 198 unidades y precio de catálogo S/ 2.308,41. Compara con la evidencia más reciente si se repitió el ETL.

Revisión adicional del 1 de octubre de 2026 para el prompt 05: la cuenta activa coincidió con los outputs; el workgroup estaba `ENABLED`, con engine v3, ubicación de resultados impuesta y SSE-S3. `GetBucketEncryption` confirmó `AES256`, SSE-S3, en curated y artefactos. Se verificaron nuevamente las seis tablas Parquet. `00` terminó `SUCCEEDED` con seis filas, ID `89ff342b-9671-4ac8-8393-0188769e430b`; `01` terminó `SUCCEEDED` con 54 filas, ID `a8ac3d1c-a2aa-4156-84a7-1634287e8f19`. La sesión devolvió `ExpiredTokenException` antes de iniciar `02`; esta repetición no verificó `02` ni `03` y no reemplazó `cdk.out/athena-demo-evidence.json`, que conserva la ejecución completa anterior. Esta limitación corresponde a la repetición local por CLI. La verificación posterior en Quick Sight sí consultó los tres datasets y mostró filas y visuales interpretables. Para generar un nuevo archivo completo de evidencia CLI, renueva la sesión docente y repite `demo:athena`; no requiere alta de Quick Sight.

Objetos creados y reabiertos desde consola:

| Objeto                                                   | Nombre / ID y enlace                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fuente Athena validada                                   | [mercadoya-athena-curated](https://us-east-1.quicksight.aws.amazon.com/sn/account/rodrigoperez/data/data-source/Connection%3Ab60bf4a9-5e8f-4c8a-b2f1-00affc00d727), ID `b60bf4a9-5e8f-4c8a-b2f1-00affc00d727`                    |
| Ventas, SQL `02`, Direct Query                           | [mercadoya-ventas-segmento-curated](https://us-east-1.quicksight.aws.amazon.com/sn/account/rodrigoperez/data-sets/d08b3c5f-afd9-426e-9385-332daecf6f8a/prepare), ID `d08b3c5f-afd9-426e-9385-332daecf6f8a`; preview de 180 filas |
| Pedidos, SQL `01`, Direct Query                          | [mercadoya-pedidos-mes-estado-curated](https://us-east-1.quicksight.aws.amazon.com/sn/data-sets/83ec64f6-ea70-4946-9ba6-80403ea49da5/view), ID `83ec64f6-ea70-4946-9ba6-80403ea49da5`                                            |
| Productos, SQL `03` con PEN antes de LIMIT, Direct Query | [mercadoya-top-productos-curated](https://us-east-1.quicksight.aws.amazon.com/sn/data-sets/664f2558-9370-49c4-a2d6-b43281bae98f/view), ID `664f2558-9370-49c4-a2d6-b43281bae98f`                                                 |
| Analysis guardado, autosave activo y reabierto           | [MercadoYa · Athena curated](https://us-east-1.quicksight.aws.amazon.com/sn/account/rodrigoperez/analyses/b1992946-84f9-4f7b-8915-8670b236eb1b), ID `b1992946-84f9-4f7b-8915-8670b236eb1b`                                       |
| Dashboard publicado y comprobado, tres hojas             | [MercadoYa · Clase BI](https://us-east-1.quicksight.aws.amazon.com/sn/account/rodrigoperez/dashboards/6e54098a-34ed-4cfe-92f8-0d968cff2822), ID `6e54098a-34ed-4cfe-92f8-0d968cff2822`                                           |

Comprobación desde la vista publicada: ventas en PEN mostró cuatro segmentos, con importes 1.574.965,89 (new), 1.608.106,76 (wholesale), 1.759.528,14 (retail) y 1.848.159,77 (vip), total S/ 6.790.760,56. Ciudad Lima cambió el total a S/ 371.889,70. El control `channel = web` cambió las series de pedidos; al restaurar el dashboard volvieron los valores iniciales. El ranking y la tabla mostraron diez productos, ventas descendentes, 198 unidades y precio 2.308,41 PEN para Max Filtro 197. Se comprobó `month (Month)`, `order_count (Sum)`, `sales_amount (Sum)`, `product_sales_amount (Sum)`, `units_sold (Sum)` y `catalog_price (Max)` en los field wells. La vista final se restauró a sus opciones publicadas. Los ejes monetarios abrevian miles/millones; tabla y tooltips permiten ver importes precisos.

Para evidencia de futuras repeticiones, guarda capturas en `cdk.out/`, ignorado por Git: conexión/workgroup, preview con filas y tipos, filtros/agregaciones del analysis y dashboard abierto. Esta sesión verificó las capturas en pantalla; no añadió archivos de captura al repositorio.

Referencias oficiales de AWS verificadas el 1 de octubre de 2026: [autorizar Athena y S3](https://docs.aws.amazon.com/quick/latest/userguide/athena.html), [crear dataset Athena](https://docs.aws.amazon.com/quick/latest/userguide/create-a-data-set-athena.html), [reutilizar fuente Athena](https://docs.aws.amazon.com/quick/latest/userguide/create-a-data-set-existing.html), [elegir SPICE o Direct Query](https://docs.aws.amazon.com/quick/latest/userguide/prepare-database-data.html), [crear barras](https://docs.aws.amazon.com/quick/latest/userguide/bar-charts.html), [publicar dashboard sin compartir](https://docs.aws.amazon.com/quick/latest/userguide/creating-a-dashboard.html), [actualizar Direct Query](https://docs.aws.amazon.com/quick/latest/userguide/refreshing-data.html) y [actualizar SPICE](https://docs.aws.amazon.com/quick/latest/userguide/refreshing-imported-data.html).

## Checklist de fallos

| Síntoma                                      | Comprobación y acción                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consulta en otro workgroup                   | Selecciona `mercadoya-cloud-analytics-demo` en Athena y en la fuente QuickSight.                                                                                                                                                                                                                          |
| Tipos CSV o DB equivocada                    | Selecciona `AwsDataCatalog` y `mercadoya_analytics_demo_curated`, no la DB raw.                                                                                                                                                                                                                           |
| Resultado fuera de `athena-results/`         | Comprueba workgroup y `AthenaResultsLocation`; conserva el override y los permisos del bucket de artefactos.                                                                                                                                                                                              |
| Crawler no registra las seis tablas          | Comprueba objetos, targets de carpeta por tabla y `CombineCompatibleSchemas`. Si el stack es antiguo, ejecuta `pnpm cdk diff` y `pnpm run deploy --outputs-file cdk.out/outputs.json` con este scaffold; no agregues `TableLevelConfiguration=2` ni apuntes al CSV. Luego vuelve a ejecutar los crawlers. |
| Athena falla o curated está incompleto       | Espera ETL `SUCCEEDED`, verifica Parquet de las seis tablas y espera curated `READY` con crawl `SUCCEEDED` actual. Si el ETL falló, repítelo completo antes de curated.                                                                                                                                   |
| `AccessDenied`                               | Confirma sesión y cuenta, permisos de Glue y `iam:PassRole`, política Athena de la identidad y autorización de Athena/S3 para QuickSight. Si la cuenta usa Lake Formation, revisa sus grants.                                                                                                             |
| Faltan objetos raw o el job no encuentra CSV | Lista `RAW_LOCATION` y repite el paso 1; debe existir cada `raw/<tabla>/<tabla>.csv`. Si falta el script, repite la copia del paso 3.                                                                                                                                                                     |
| Timeout del script o run ya activo           | Inspecciona el ID y estado en AWS antes de repetir. Un timeout local no cancela el job o crawler.                                                                                                                                                                                                         |

## Teardown

Desde el app, carga los outputs en la terminal como antes. Espera a que terminen las ejecuciones de Glue y Athena o detenlas desde sus consolas. Desadjunta `AthenaQueryPolicyArn` de cualquier identidad externa. Elimina desde QuickSight solo los análisis, datasets y fuente creados para esta demo; el stack no los administra y SPICE conserva una copia propia.

Vacía los prefijos y luego cualquier objeto restante de los tres buckets del demo. Esto incluye el script copiado a `glue/scripts/`, pues S3 no elimina buckets con objetos:

```bash
aws s3 rm "$(output AthenaResultsLocation)" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "$RAW_LOCATION" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "$CURATED_LOCATION" --recursive --region "$CDK_DEFAULT_REGION"
aws s3 rm "$(output GlueTempLocation)" --recursive --region "$CDK_DEFAULT_REGION"
for bucket in "$(output RawBucketName)" "$(output CuratedBucketName)" "$ARTIFACTS_BUCKET"; do
  aws s3 rm "s3://${bucket}/" --recursive --region "$CDK_DEFAULT_REGION"
done
pnpm destroy
```

Los buckets del scaffold no tienen versionado ni borrado automático. Si hubo uploads multipart incompletos, abórtalos desde S3 antes del destroy. Con `RemovalPolicy.DESTROY`, el stack elimina buckets vacíos, crawlers, clasificador, job, roles, política, logs propios, workgroup e historial y las dos DB del catálogo. Conserva el toolkit `CDKToolkit` y el grupo compartido `/aws-glue/crawlers`. Comprueba `DELETE_COMPLETE` en CloudFormation. No hay push al remoto ni cambios en repositorios de estudiantes.

Referencias AWS consultadas el 1 de octubre de 2026. El alcance es demostrativo, sin HA ni endurecimiento productivo.
