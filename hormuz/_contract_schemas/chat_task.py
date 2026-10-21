"""V1 receipts for explicit, local-only Koto tasks in an existing chat."""
import re
from pathlib import Path
from .common import ContractValidationError, _exact_keys

TASK_FIELDS = {'schema_id', 'schema_version', 'text', 'model', 'routed_model', 'locality', 'destination',
               'generation', 'work_id', 'selection', 'reasoning_effort'}
PROPOSAL_FIELDS = TASK_FIELDS | {'purpose', 'review_required', 'applied'}
MODELS_FIELDS = {'schema_id', 'schema_version', 'default_model', 'models'}
ERROR_FIELDS = {'schema_id', 'schema_version', 'error', 'submission', 'retried'}
OWNER_FIELDS = {'schema_id', 'schema_version', 'normal_home', 'router_home', 'generation'}
ERROR_CODES = {'prompt_limit', 'separate_router_home_required', 'router_unavailable', 'router_ownership_changed',
               'owned_loopback_router_required', 'router_request_rejected', 'response_limit', 'model_not_qualified',
               'execution_selection_changed', 'task_incomplete', 'task_unavailable', 'router_upgrade_required',
               'proposal_output_invalid'}


def label(value):
    return isinstance(value, str) and 0 < len(value) <= 4096 and '\x00' not in value


def _validate_task_fields(value, efforts):
    if (not all(label(value[key]) for key in ('model', 'routed_model', 'destination'))
            or value['locality'] != 'local' or value['selection'] not in {'model', 'router_default'}
            or value['reasoning_effort'] not in efforts
            or not isinstance(value['text'], str) or len(value['text']) > 2 * 1024 * 1024
            or not isinstance(value['generation'], str) or re.fullmatch('[a-f0-9]{64}', value['generation']) is None
            or value['work_id'] is not None and not label(value['work_id'])):
        raise ContractValidationError('Invalid explicit chat task receipt')


def validate_task(value):
    _exact_keys(value, TASK_FIELDS)
    _validate_task_fields(value, {'low', 'medium', 'high', 'max'})


def validate_models(value):
    _exact_keys(value, MODELS_FIELDS)
    if (not label(value['default_model']) or not isinstance(value['models'], list)
            or len(value['models']) > 128 or not all(label(model) for model in value['models'])
            or len(set(value['models'])) != len(value['models'])):
        raise ContractValidationError('Invalid explicit chat model list')


def validate_proposal(value):
    _exact_keys(value, PROPOSAL_FIELDS)
    _validate_task_fields(value, {'none', 'low', 'medium', 'high', 'max'})
    if (value['selection'] != 'model' or value['purpose'] != 'proposal'
            or value['review_required'] is not True or value['applied'] is not False
            or not value['text'].strip()):
        raise ContractValidationError('Invalid explicit chat proposal receipt')


def validate_error(value):
    _exact_keys(value, ERROR_FIELDS)
    _exact_keys(value['error'], {'code'})
    if (value['error']['code'] not in ERROR_CODES or value['submission'] not in {'not_submitted', 'possibly_submitted'}
            or value['retried'] is not False):
        raise ContractValidationError('Invalid explicit chat failure receipt')


def validate_owner(value):
    _exact_keys(value, OWNER_FIELDS)
    if (not all(label(value[key]) and Path(value[key]).is_absolute() for key in ('normal_home','router_home'))
            or value['normal_home'] == value['router_home']
            or not isinstance(value['generation'],str) or re.fullmatch('[a-f0-9]{32}',value['generation']) is None):
        raise ContractValidationError('Invalid explicit chat owner')
