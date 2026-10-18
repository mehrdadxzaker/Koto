"""Check the unchanged publisher GGUF through the real native/engine preflight.

No completions are submitted. Preserve this stock preparation separately from
the final treatment, including a rejection if a strict template is incompatible.
"""
import importlib.util
from pathlib import Path
import shutil


DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stock_devstral', DIRECTORY / 'stock-campaign-runner.py')
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
driver.ROOT = driver.retained.ROOT = Path('/private/tmp/koto-native-v10-stock-preflight-20261018')
driver.DIRECTORY = DIRECTORY / 'stock-preflight'
driver.DIRECTORY.mkdir(mode=0o700, exist_ok=False)
shutil.copy2(DIRECTORY / 'corpus.json', driver.DIRECTORY / 'corpus.json')
driver.initialize()
driver.capture()
