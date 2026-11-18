from ..bot import register_provider
from ..bot.guide import HOST
from ..bot.standalone_dsh import StandaloneDSH
from ._common import app_path

register_provider(StandaloneDSH(host=HOST, home_dir=app_path("agent")))
