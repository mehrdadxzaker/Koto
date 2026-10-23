"""The offline draft contract grants no runtime or qualification authority."""
from ..harness_improvement import REPORT_FIELDS as FIELDS, ImprovementError, validate_proposal
from .common import ContractValidationError


def validate(value):
    try:
        validate_proposal(value)
    except ImprovementError:
        raise ContractValidationError('invalid offline harness improvement proposal') from None
