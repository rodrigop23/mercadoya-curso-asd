from agent_service.agents.specialist import build_specialist
from agent_service.prompts import POST_SALE_PROMPT

READ_TOOLS = {"list_my_orders", "get_my_order"}
PROPOSAL_NAMES = {"propose_cancel_order"}

post_sale = build_specialist("post_sale", READ_TOOLS, PROPOSAL_NAMES, POST_SALE_PROMPT)
