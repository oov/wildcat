EMCC = emcc
EMCONF = emconfigure
EMMAKE = emmake

OGG_INCLUDE=$(CURDIR)/ogg/include
OGG_LIBS=$(CURDIR)/ogg/src/.libs
OPUS_INCLUDE=$(CURDIR)/opus/include
OPUS_LIBS=$(CURDIR)/opus/.libs
OPUSFILE_INCLUDE=$(CURDIR)/opusfile/include
OPUSFILE_LIBS=$(CURDIR)/opusfile/.libs
SPEEXDSP_INCLUDE=$(CURDIR)/speexdsp/include/speex
SPEEXDSP_SRC=$(CURDIR)/speexdsp/libspeexdsp

FILES = $(SPEEXDSP_SRC)/resample.c src/decoder/main.c
CFLAGS = -O3 -I$(OGG_INCLUDE) -I$(OPUS_INCLUDE) -I$(OPUSFILE_INCLUDE) -I$(SPEEXDSP_INCLUDE) -DOUTSIDE_SPEEX -DRANDOM_PREFIX=spx -DFLOATING_POINT -DEXPORT=
LIBS = $(OGG_LIBS)/libogg.so $(OPUS_LIBS)/libopus.so $(OPUSFILE_LIBS)/libopusfile.so

ogg:
	cd ogg && \
	./autogen.sh && \
	$(EMCONF) ./configure && \
	$(EMMAKE) make

opus:
	cd opus && \
	./autogen.sh && \
	$(EMCONF) ./configure --disable-intrinsics --disable-doc --disable-extra-programs && \
	$(EMMAKE) make

opusfile:
	cd opusfile && \
	./autogen.sh && \
	DEPS_CFLAGS="-I$(OGG_INCLUDE) -I$(OPUS_INCLUDE)" \
	DEPS_LIBS="-L$(OGG_LIBS) -L$(OPUS_LIBS)" \
	$(EMCONF) ./configure --disable-http --disable-examples --disable-doc && \
	$(EMMAKE) make

decoder: $(FILES)
	$(EMCC) $(CFLAGS) $(FILES) $(LIBS) -o dist/decoder-core.js --llvm-lto 1 -s AGGRESSIVE_VARIABLE_ELIMINATION=1 -s NO_FILESYSTEM=1 -s NO_EXIT_RUNTIME=1 -s EXPORTED_FUNCTIONS="['_wc_open', '_wc_close', '_wc_seek', '_wc_tell', '_wc_buffer', '_wc_channels', '_wc_read']" && \
	mv dist/decoder-core.js.mem dist/decoder-core.mem.js
