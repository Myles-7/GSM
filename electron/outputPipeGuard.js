function guardOutputPipe(stream) {
  // A detached/hidden launcher can close stdout without invalidating the app.
  stream?.on('error', error => {
    if (error.code !== 'EPIPE') throw error;
  });
}

module.exports = { guardOutputPipe };
