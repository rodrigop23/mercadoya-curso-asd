"""Recorta solo la ventana del modelo y mantiene completos los turnos de herramientas."""

from langchain_core.messages import trim_messages


def trim_history(messages, max_messages=40):
    trimmed = trim_messages(
        messages,
        max_tokens=max_messages,
        token_counter=len,
        strategy="last",
        start_on="human",
        include_system=True,
        allow_partial=False,
    )
    if not any(message.type == "human" for message in trimmed):
        # Un turno excepcionalmente grande queda completo; el límite es una ventana objetivo.
        last_human = next(
            (i for i in range(len(messages) - 1, -1, -1) if messages[i].type == "human"),
            len(messages),
        )
        systems = [messages[0]] if messages and messages[0].type == "system" else []
        trimmed = [*systems, *messages[last_human:]]
    return trimmed
