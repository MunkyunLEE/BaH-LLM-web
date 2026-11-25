EIGEN ?= /usr/include/eigen3
SRC := $(wildcard src/*.cpp)
LIB := $(filter-out src/cli.cpp,$(SRC))
OBJ := $(patsubst src/%.cpp,build/native/%.o,$(SRC))
CXXFLAGS := -std=c++17 -O2 -I$(EIGEN)

native: build/bhcli

build/native/%.o: src/%.cpp src/*.hpp
	@mkdir -p build/native
	$(CXX) $(CXXFLAGS) -c $< -o $@

build/bhcli: $(OBJ)
	$(CXX) $(OBJ) -o $@

clean:
	rm -rf build

ZIG ?= python3 -m ziglang
WOBJ := $(patsubst src/%.cpp,build/wasm/%.o,$(LIB))
WFLAGS := -std=c++17 -O2 -fno-exceptions -I$(EIGEN) -DEIGEN_NO_DEBUG -DNDEBUG -target wasm32-wasi

build/wasm/%.o: src/%.cpp src/*.hpp
	@mkdir -p build/wasm
	$(ZIG) c++ $(WFLAGS) -c $< -o $@

wasm: $(WOBJ)
	$(ZIG) c++ -target wasm32-wasi -mexec-model=reactor -O2 $(WOBJ) -o ../web/bh.wasm \
	  -Wl,--export=bh_alloc -Wl,--export=bh_free -Wl,--export=bh_last -Wl,--export=bh_create -Wl,--export=bh_destroy \
	  -Wl,--export=bh_model -Wl,--export=bh_step -Wl,--export=bh_status -Wl,--export=bh_result -Wl,--export=bh_frames_ptr \
	  -Wl,--export=bh_frames_len -Wl,--export=bh_modal -Wl,--export=bh_kinematic -Wl,--export=bh_dof -Wl,--export=bh_space -Wl,--export=malloc -Wl,--export=free \
	  -Wl,--strip-all -Wl,-z,stack-size=8388608
