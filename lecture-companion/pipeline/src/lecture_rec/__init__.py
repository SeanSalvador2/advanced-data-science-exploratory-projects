"""lecture_rec - the local recorder and transcriber of the lecture companion.

Records a lecture beside the browser app (which writes slide and note events),
transcribes it locally with a vocabulary bias taken from the slide deck, and
keeps the evaluation harness that decided the audio path was good enough.
No cloud APIs, no API keys, ever.
"""

__version__ = "0.1.0"
