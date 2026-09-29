class JobError(Exception):
    """A failure the server should hear about, with a verdict on retrying.

    Non-retryable means "this input will never work" (corrupt file, unknown
    format) — requeueing it would just burn GPU time on every worker.
    """

    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
