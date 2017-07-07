#include <stdlib.h>
#include <opusfile.h>
#include <emscripten/emscripten.h>
#include <speex_resampler.h>

// *IMPORATNT*
// This program does not consider changes in the number of channels in the middle of a stream.

void *opus_fileimage = NULL;
OggOpusFile *ctx = NULL;
SpeexResamplerState *resampler = NULL;
int channels = 0;
ogg_int64_t current_position = 0;

int opus_buffer_size = 0;
float *opus_buffer = NULL;

int dest_buffer_size = 0;
float *dest_buffer = NULL;

#ifdef __cplusplus
extern "C" {
#endif

void EMSCRIPTEN_KEEPALIVE wc_close() {
  if (dest_buffer != NULL) {
    if (dest_buffer != opus_buffer) {
      free(dest_buffer);
    }
    dest_buffer_size = 0;
    dest_buffer = NULL;
  }
  if (resampler != NULL) {
    spx_resampler_destroy(resampler);
    resampler = NULL;
  }
  if (opus_buffer != NULL) {
    free(opus_buffer);
    opus_buffer_size = 0;
    opus_buffer = NULL;
  }
  if (ctx != NULL) {
    op_free(ctx);
    ctx = NULL;
  }
  channels = 0;
  if (opus_fileimage != NULL) {
    free(opus_fileimage);
    opus_fileimage = NULL;
  }
}

const OpusTags* EMSCRIPTEN_KEEPALIVE wc_tags() {
  if (ctx == NULL) {
    return NULL;
  }
  return op_tags(ctx, -1);
}

// ~-1 = error / 0~ = pcm total length
int EMSCRIPTEN_KEEPALIVE wc_open(void *p, int len, int target_samplerate, int buffer_size_msec) {
  if (ctx != NULL) {
    return -1;
  }

  int err;
  OggOpusFile *newctx = op_open_memory(p, (size_t)len, &err);
  if (newctx == NULL) {
    return -1;
  }

  wc_close();

  ctx = newctx;
  opus_fileimage = p;
  current_position = 0;
  wc_tags();

  channels = op_channel_count(ctx, -1);
  if (channels == 0) {
    return -2;
  }

  opus_buffer_size = sizeof(float)*((48000*buffer_size_msec)/1000)*channels;
  opus_buffer = (float*)malloc(opus_buffer_size);
  if (opus_buffer == NULL) {
    wc_close();
    return -3;
  }

  // If the target samplerate is not 48kHz, initialize the resampler
  if (target_samplerate != 48000) {
    resampler = spx_resampler_init(channels, 48000, target_samplerate, 5, &err);
    if (resampler == NULL) {
      wc_close();
      return -4;
    }
    spx_resampler_skip_zeros(resampler);

    dest_buffer_size = sizeof(float)*((target_samplerate*(buffer_size_msec+1))/1000)*channels;
    dest_buffer = (float*)malloc(dest_buffer_size);
    if (dest_buffer == NULL) {
      wc_close();
      return -5;
    }
  } else {
    dest_buffer_size = opus_buffer_size;
    dest_buffer = opus_buffer;
  }

  ogg_int64_t r = op_pcm_total(ctx, -1);
  if (r < 0) {
    wc_close();
    return -6;
  }
  return (int)r;
}

// ~-1 = error / 0 = ok
int EMSCRIPTEN_KEEPALIVE wc_seek(int sample) {
  if (ctx == NULL) {
    return -1;
  }
  ogg_int64_t pos = (ogg_int64_t)sample;
  int r = op_pcm_seek(ctx, pos);
  if (r == 0) {
    current_position = pos;
  }
  return r;
}

// ~-1 = error / 0~ = sample pos
int EMSCRIPTEN_KEEPALIVE wc_tell() {
  if (ctx == NULL) {
    return -1;
  }
  return op_pcm_tell(ctx);
}

float *EMSCRIPTEN_KEEPALIVE wc_buffer() {
  if (ctx == NULL) {
    return NULL;
  }
  return dest_buffer;
}

// 0 = error
int EMSCRIPTEN_KEEPALIVE wc_channels() {
  if (ctx == NULL) {
    return 0;
  }
  return channels;
}

int EMSCRIPTEN_KEEPALIVE wc_read(int end_sample_pos) {
  if (ctx == NULL) {
    return -1;
  }
  if (current_position >= end_sample_pos) {
    return 0;
  }
  int read_size = opus_buffer_size / channels;
  if (end_sample_pos - current_position < read_size) {
    read_size = end_sample_pos - current_position;
  }
  for (;;) {
    int written = op_read_float(ctx, opus_buffer, read_size * channels, NULL);
    if (written == OP_HOLE) {
      continue;
    }
    if (written < 0) {
      return written;
    }
    current_position += written;
    if (resampler == NULL) {
      return written;
    }
    spx_uint32_t in_len = (spx_uint32_t)written, out_len = (spx_uint32_t)dest_buffer_size / channels;
    int r = speex_resampler_process_interleaved_float(resampler, opus_buffer, &in_len, dest_buffer, &out_len);
    if (r != RESAMPLER_ERR_SUCCESS) {
      return r;
    }
    if (written != (int)in_len) {
      return -2;
    }
    return (int)out_len;
  }
}
#ifdef __cplusplus
}
#endif
