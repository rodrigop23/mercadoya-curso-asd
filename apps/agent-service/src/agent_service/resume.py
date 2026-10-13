"""Rechaza resumes viejos antes de crear un run en Agent Server 0.16.0."""

from langgraph_sdk import Auth, get_client

ALREADY_RESPONDED = "Esta confirmación ya fue respondida"


async def validate_pending_resume(value):
    kwargs = value.get("kwargs") or {}
    command = kwargs.get("command") or {}
    if "resume" not in command:
        return
    config = kwargs.get("config") or {}
    configurable = config.get("configurable") or {}
    # Una confirmación autoriza el checkpoint actual, nunca un replay histórico.
    if configurable.get("checkpoint_id"):
        raise Auth.exceptions.HTTPException(status_code=409, detail=ALREADY_RESPONDED)
    thread_id = value.get("thread_id")
    if not thread_id:
        raise Auth.exceptions.HTTPException(status_code=409, detail=ALREADY_RESPONDED)
    user = configurable.get("langgraph_auth_user") or {}
    token = user.get("token")
    if not token:
        raise Auth.exceptions.HTTPException(status_code=401, detail="Credencial inválida")
    # Cliente ASGI local por llamada, sin claves heredadas ni caché de headers de usuario.
    client = get_client(api_key=None, headers={"Authorization": f"Bearer {token}"})
    try:
        thread = await client.threads.get(str(thread_id))
    finally:
        await client.aclose()
    interrupts = [i for values in (thread.get("interrupts") or {}).values() for i in values]
    ids = {i["id"] for i in interrupts if i.get("id")}
    resume = command["resume"]
    mapped = isinstance(resume, dict) and "action_id" not in resume
    if thread["status"] != "interrupted" or len(ids) != 1 or (mapped and set(resume) != ids):
        raise Auth.exceptions.HTTPException(status_code=409, detail=ALREADY_RESPONDED)
