from langgraph.graph import MessagesState


class AgentState(MessagesState):
    input_blocked: bool
    pii_notice_pending: bool
    domain_blocked: bool
    recent_confirmation: bool
    active_agent: str | None
    last_domain_category: str | None
    route_reason: str | None
    last_domain_in_domain: bool
