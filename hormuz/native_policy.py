"""Configured secret egress policy for an explicit native task prompt."""
from .codex_native_session import NativeSessionError
from .credentials import resolve_upstream_credentials
from .redaction import RedactionError, SecretRedactor


def prepare_prompt(config, prompt):
    """Apply local policy using configured secrets, never native account files."""
    if config.policy_control.mode != 'local':
        raise NativeSessionError('native_managed_policy_unsupported')
    protected = [("credential", identity.token) for identity in config.identities_by_token.values() if identity.token]
    protected.extend(("credential", value) for value in resolve_upstream_credentials(config).values() if value)
    if config.ingress.credential:
        protected.append(("credential", config.ingress.credential))
    try:
        result = SecretRedactor(config.secret_controls, tuple(protected)).inspect({"input": prompt})
    except RedactionError:
        raise NativeSessionError('native_secret_policy_invalid') from None
    if config.secret_controls.mode == 'deny' and result.count:
        raise NativeSessionError('native_secret_detected')
    return result.value['input']
