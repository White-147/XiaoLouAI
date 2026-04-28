@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"

set "SERVICE_DIR=%ROOT%\core-api\video-replace-service"
set "VENV_DIR=%SERVICE_DIR%\.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"
set "ENV_FILE=%SERVICE_DIR%\.env.local"

set "SMALL_LOG=%SERVICE_DIR%\.install-small.log"
set "TORCH_LOG=%SERVICE_DIR%\.install-torch.log"
set "ML_LOG=%SERVICE_DIR%\.install-ml.log"
set "SAM2_LOG=%SERVICE_DIR%\.install-sam2.log"
set "VACE_LOG=%SERVICE_DIR%\.install-vace.log"
set "CUDA124_LOG=%SERVICE_DIR%\.install-cuda124.log"
set "FLASHATTN_LOG=%SERVICE_DIR%\.install-flash-attn.log"

set "CUDA124_HOME=%ProgramFiles%\NVIDIA GPU Computing Toolkit\CUDA\v12.4"
set "CUDA124_URL=https://developer.download.nvidia.com/compute/cuda/12.4.1/network_installers/cuda_12.4.1_windows_network.exe"
set "CUDA_CACHE_DIR=%ROOT%\tools\cuda"
set "CUDA_NET_EXE=%CUDA_CACHE_DIR%\cuda_12.4.1_windows_network.exe"
set "CUDA_NET_DIR=%TEMP%\cuda124-network-full"
set "CUDA124_COMPONENTS=thrust_12.4 cudart_12.4 cupti_12.4 nvcc_12.4 nvrtc_12.4 nvrtc_dev_12.4 nvtx_12.4 cublas_12.4 cublas_dev_12.4 cufft_12.4 cufft_dev_12.4 curand_12.4 curand_dev_12.4 cusolver_12.4 cusolver_dev_12.4 cusparse_12.4 cusparse_dev_12.4 npp_12.4 npp_dev_12.4 nvjpeg_12.4 nvjpeg_dev_12.4 nvjitlink_12.4 visual_studio_integration_12.4"

set "FLASHATTN_VERSION=2.8.3"
set "FLASHATTN_CACHE_DIR=%TEMP%\flashattn-src-cache"
set "FLASHATTN_BUILD_ROOT=%TEMP%\flashattn-build"
set "FLASHATTN_BUILD_DIR=%FLASHATTN_BUILD_ROOT%\flash_attn-%FLASHATTN_VERSION%"
set "FLASHATTN_RUNNER=%FLASHATTN_BUILD_ROOT%\build_flash_attn.cmd"

set "ASCII_ROOT="
set "ASCII_SERVICE_DIR="
set "ASCII_VENV_PYTHON="
set "ASCII_SITE_PACKAGES="
set "BOOTSTRAP_PY="
set "VCVARS64="

if not exist "%SERVICE_DIR%\pyproject.toml" (
    echo [error] Missing service directory: %SERVICE_DIR%
    exit /b 1
)

echo.
echo ============================================================
echo Video Replace setup
echo Root:    %ROOT%
echo Service: %SERVICE_DIR%
echo ============================================================

call :detect_bootstrap_python || exit /b 1
call :ensure_venv || exit /b 1

echo.
echo [step] Upgrade pip / setuptools / wheel
>> "%SMALL_LOG%" echo ============================================================
>> "%SMALL_LOG%" echo [%DATE% %TIME%] Upgrade pip / setuptools / wheel
>> "%SMALL_LOG%" echo CMD: "%VENV_PYTHON%" -m pip install --upgrade pip "setuptools<82" wheel
"%VENV_PYTHON%" -m pip install --upgrade pip "setuptools<82" wheel >> "%SMALL_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Upgrade pip / setuptools / wheel failed. See %SMALL_LOG%
    exit /b 1
)
echo [ok] Upgrade pip / setuptools / wheel
echo.
echo [step] Install video-replace-service
>> "%SMALL_LOG%" echo ============================================================
>> "%SMALL_LOG%" echo [%DATE% %TIME%] Install video-replace-service
>> "%SMALL_LOG%" echo CMD: "%VENV_PYTHON%" -m pip install -e "%SERVICE_DIR%"
"%VENV_PYTHON%" -m pip install -e "%SERVICE_DIR%" >> "%SMALL_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Install video-replace-service failed. See %SMALL_LOG%
    exit /b 1
)
echo [ok] Install video-replace-service
call :ensure_cuda_torch || exit /b 1
echo.
echo [step] Install Wan runtime extras
>> "%ML_LOG%" echo ============================================================
>> "%ML_LOG%" echo [%DATE% %TIME%] Install Wan runtime extras
>> "%ML_LOG%" echo CMD: "%VENV_PYTHON%" -m pip install --upgrade ninja tokenizers dashscope "gradio>=5.0.0" "huggingface_hub[cli]"
"%VENV_PYTHON%" -m pip install --upgrade ninja tokenizers dashscope "gradio>=5.0.0" "huggingface_hub[cli]" >> "%ML_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Install Wan runtime extras failed. See %ML_LOG%
    exit /b 1
)
echo [ok] Install Wan runtime extras
call :ensure_windows_flash_attn || exit /b 1
call :ensure_sam2 || exit /b 1
call :ensure_sam2_weight tiny sam2.1_hiera_tiny.pt || exit /b 1
call :ensure_sam2_weight base_plus sam2.1_hiera_base_plus.pt || exit /b 1
call :ensure_wan2_repo || exit /b 1
call :ensure_env_file || exit /b 1
call :ensure_vace_weights_background || exit /b 1

echo.
echo [done] Video Replace setup finished.
echo [done] Logs:
echo   %SMALL_LOG%
echo   %TORCH_LOG%
echo   %ML_LOG%
echo   %SAM2_LOG%
echo   %FLASHATTN_LOG%
echo   %VACE_LOG%
exit /b 0

:detect_bootstrap_python
py -3.12 -c "import sys" >nul 2>&1 && set "BOOTSTRAP_PY=py -3.12"
if not defined BOOTSTRAP_PY py -3.11 -c "import sys" >nul 2>&1 && set "BOOTSTRAP_PY=py -3.11"
if not defined BOOTSTRAP_PY py -3.10 -c "import sys" >nul 2>&1 && set "BOOTSTRAP_PY=py -3.10"
if not defined BOOTSTRAP_PY python -c "import sys" >nul 2>&1 && set "BOOTSTRAP_PY=python"
if not defined BOOTSTRAP_PY (
    echo [error] Could not find a bootstrap Python interpreter.
    exit /b 1
)
echo [ok] Bootstrap Python: %BOOTSTRAP_PY%
exit /b 0

:ensure_venv
if exist "%VENV_PYTHON%" (
    echo [ok] Virtualenv already exists: %VENV_DIR%
    exit /b 0
)
echo [step] Creating virtualenv: %VENV_DIR%
call %BOOTSTRAP_PY% -m venv "%VENV_DIR%"
if errorlevel 1 (
    echo [error] Failed to create virtualenv.
    exit /b 1
)
if not exist "%VENV_PYTHON%" (
    echo [error] Virtualenv Python not found after creation.
    exit /b 1
)
echo [ok] Virtualenv created.
exit /b 0

:run_logged
set "STEP_NAME=%~1"
set "LOG_FILE=%~2"
set "CMD_STR=%~3"
echo.
echo [step] %STEP_NAME%
if not exist "%SERVICE_DIR%" mkdir "%SERVICE_DIR%" >nul 2>&1
>> "%LOG_FILE%" echo ============================================================
>> "%LOG_FILE%" echo [%DATE% %TIME%] %STEP_NAME%
>> "%LOG_FILE%" echo CMD: %CMD_STR%
cmd /d /c "%CMD_STR%" >> "%LOG_FILE%" 2>&1
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo [error] %STEP_NAME% failed. See %LOG_FILE%
    exit /b %RC%
)
echo [ok] %STEP_NAME%
exit /b 0

:ensure_cuda_torch
"%VENV_PYTHON%" -c "import torch; raise SystemExit(0 if torch.version.cuda == '12.4' else 1)" >nul 2>&1
if "%ERRORLEVEL%"=="0" (
    echo [ok] torch/cu124 already installed.
    exit /b 0
)
echo.
echo [step] Install torch 2.6.0 / cu124
>> "%TORCH_LOG%" echo ============================================================
>> "%TORCH_LOG%" echo [%DATE% %TIME%] Install torch 2.6.0 / cu124
>> "%TORCH_LOG%" echo CMD: "%VENV_PYTHON%" -m pip install --index-url https://download.pytorch.org/whl/cu124 torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0
"%VENV_PYTHON%" -m pip install --index-url https://download.pytorch.org/whl/cu124 torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 >> "%TORCH_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Install torch 2.6.0 / cu124 failed. See %TORCH_LOG%
    exit /b 1
)
"%VENV_PYTHON%" -c "import torch; raise SystemExit(0 if torch.version.cuda == '12.4' else 1)" >nul 2>&1
if errorlevel 1 (
    echo [error] torch/cu124 verification failed.
    exit /b 1
)
echo [ok] torch/cu124 ready.
exit /b 0

:ensure_sam2
"%VENV_PYTHON%" -c "import sam2" >nul 2>&1
if "%ERRORLEVEL%"=="0" (
    echo [ok] SAM2 already installed.
    exit /b 0
)
echo.
echo [step] Install SAM2
>> "%SAM2_LOG%" echo ============================================================
>> "%SAM2_LOG%" echo [%DATE% %TIME%] Install SAM2
>> "%SAM2_LOG%" echo CMD: "%VENV_PYTHON%" -m pip install git+https://github.com/facebookresearch/sam2.git
"%VENV_PYTHON%" -m pip install git+https://github.com/facebookresearch/sam2.git >> "%SAM2_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Install SAM2 failed. See %SAM2_LOG%
    exit /b 1
)
echo [ok] SAM2 ready.
exit /b 0

:ensure_sam2_weight
set "SAM2_SIZE=%~1"
set "SAM2_FILE=%~2"
if exist "%SERVICE_DIR%\weights\sam2\%SAM2_FILE%" (
    echo [ok] SAM2 %SAM2_SIZE% checkpoint already exists.
    exit /b 0
)
echo.
echo [step] Download SAM2 %SAM2_SIZE% checkpoint
>> "%SAM2_LOG%" echo ============================================================
>> "%SAM2_LOG%" echo [%DATE% %TIME%] Download SAM2 %SAM2_SIZE% checkpoint
>> "%SAM2_LOG%" echo CMD: pushd "%SERVICE_DIR%" ^& "%VENV_PYTHON%" scripts\download_weights.py --sam2 --sam2-size %SAM2_SIZE%
pushd "%SERVICE_DIR%"
if errorlevel 1 (
    echo [error] Failed to enter %SERVICE_DIR%
    exit /b 1
)
"%VENV_PYTHON%" scripts\download_weights.py --sam2 --sam2-size %SAM2_SIZE% >> "%SAM2_LOG%" 2>&1
set "SAM2_RC=%ERRORLEVEL%"
popd
if not "%SAM2_RC%"=="0" (
    echo [error] Download SAM2 %SAM2_SIZE% checkpoint failed. See %SAM2_LOG%
    exit /b %SAM2_RC%
)
exit /b 0

:ensure_wan2_repo
if exist "%SERVICE_DIR%\weights\wan2\Wan2.1\generate.py" (
    echo [ok] Wan2.1 repo already exists.
    exit /b 0
)
echo.
echo [step] Clone Wan2.1 repo
>> "%ML_LOG%" echo ============================================================
>> "%ML_LOG%" echo [%DATE% %TIME%] Clone Wan2.1 repo
>> "%ML_LOG%" echo CMD: pushd "%SERVICE_DIR%" ^& "%VENV_PYTHON%" scripts\download_weights.py --wan2-repo
pushd "%SERVICE_DIR%"
if errorlevel 1 (
    echo [error] Failed to enter %SERVICE_DIR%
    exit /b 1
)
"%VENV_PYTHON%" scripts\download_weights.py --wan2-repo >> "%ML_LOG%" 2>&1
set "WAN2_RC=%ERRORLEVEL%"
popd
if not "%WAN2_RC%"=="0" (
    echo [error] Clone Wan2.1 repo failed. See %ML_LOG%
    exit /b %WAN2_RC%
)
exit /b 0

:ensure_env_file
if not exist "%ENV_FILE%" (
    copy /y "%SERVICE_DIR%\.env.example" "%ENV_FILE%" >nul
    if errorlevel 1 (
        echo [error] Failed to create %ENV_FILE%
        exit /b 1
    )
    echo [ok] Created %ENV_FILE%
)
call :ensure_env_line "%ENV_FILE%" "VR_STORAGE_ROOT" "./data" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_WEIGHTS_ROOT" "./weights" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_SAM2_CHECKPOINT_TINY" "./weights/sam2/sam2.1_hiera_tiny.pt" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_SAM2_CHECKPOINT_BASE_PLUS" "./weights/sam2/sam2.1_hiera_base_plus.pt" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_SAM2_SIZE_DEFAULT" "base_plus" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_WAN2_REPO_DIR" "./weights/wan2/Wan2.1" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_VACE_MODEL_DIR" "./weights/vace-1.3B" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_REPLACE_MODE" "full" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_YOLO_DEVICE" "cuda" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_VACE_SUBPROCESS_TIMEOUT_S" "10800" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_VACE_SUBPROCESS_IDLE_TIMEOUT_S" "1800" || exit /b 1
call :ensure_env_line "%ENV_FILE%" "VR_VACE_OFFLOAD_MODEL" "auto" || exit /b 1
echo [ok] .env.local defaults are present.
exit /b 0

:ensure_env_line
set "ENV_TARGET=%~1"
set "ENV_KEY=%~2"
set "ENV_VALUE=%~3"
findstr /b /c:"%ENV_KEY%=" "%ENV_TARGET%" >nul 2>&1
if "%ERRORLEVEL%"=="0" exit /b 0
>> "%ENV_TARGET%" echo %ENV_KEY%=%ENV_VALUE%
if errorlevel 1 (
    echo [error] Failed to append %ENV_KEY% to %ENV_TARGET%
    exit /b 1
)
exit /b 0

:ensure_vace_weights_background
if exist "%SERVICE_DIR%\weights\vace-1.3B\config.json" if exist "%SERVICE_DIR%\weights\vace-1.3B\diffusion_pytorch_model.safetensors" (
    echo [ok] VACE 1.3B weights already exist.
    exit /b 0
)
set "VACE_RUNNER=%TEMP%\setup_video_replace_vace_download.cmd"
> "%VACE_RUNNER%" echo @echo off
>> "%VACE_RUNNER%" echo setlocal EnableExtensions
>> "%VACE_RUNNER%" echo cd /d "%SERVICE_DIR%"
>> "%VACE_RUNNER%" echo ^>^> "%VACE_LOG%" echo ============================================================
>> "%VACE_RUNNER%" echo ^>^> "%VACE_LOG%" echo [%%DATE%% %%TIME%%] Background VACE 1.3B download
>> "%VACE_RUNNER%" echo "%VENV_PYTHON%" scripts\download_weights.py --vace --vace-size 1.3B ^>^> "%VACE_LOG%" 2^>^&1
start "VACE 1.3B weights" /min cmd /d /c ""%VACE_RUNNER%""
if errorlevel 1 (
    echo [error] Failed to start the background VACE weights download.
    exit /b 1
)
echo [ok] Started background VACE 1.3B download. See %VACE_LOG%
exit /b 0

:ensure_windows_flash_attn
if /I not "%OS%"=="Windows_NT" (
    echo [ok] Non-Windows environment: skipping Windows flash-attn setup.
    exit /b 0
)
"%VENV_PYTHON%" -c "import flash_attn, flash_attn_2_cuda" >nul 2>&1
if "%ERRORLEVEL%"=="0" (
    echo [ok] flash-attn already importable.
    exit /b 0
)
call :find_vcvars64 || exit /b 1
call :ensure_cuda124_windows || exit /b 1
call :ensure_ascii_root || exit /b 1

"%ASCII_VENV_PYTHON%" -m pip show ninja >nul 2>&1
if errorlevel 1 (
    echo.
    echo [step] Install ninja in ASCII venv view
    >> "%ML_LOG%" echo ============================================================
    >> "%ML_LOG%" echo [%DATE% %TIME%] Install ninja in ASCII venv view
    >> "%ML_LOG%" echo CMD: "%ASCII_VENV_PYTHON%" -m pip install --upgrade ninja
    "%ASCII_VENV_PYTHON%" -m pip install --upgrade ninja >> "%ML_LOG%" 2>&1
    if errorlevel 1 (
        echo [error] Install ninja in ASCII venv view failed. See %ML_LOG%
        exit /b 1
    )
)

if not exist "%FLASHATTN_CACHE_DIR%" mkdir "%FLASHATTN_CACHE_DIR%" >nul 2>&1
if not exist "%FLASHATTN_BUILD_ROOT%" mkdir "%FLASHATTN_BUILD_ROOT%" >nul 2>&1

set "FLASHATTN_TARBALL="
for %%F in ("%FLASHATTN_CACHE_DIR%\flash_attn-%FLASHATTN_VERSION%.*") do (
    if exist "%%~fF" if not defined FLASHATTN_TARBALL set "FLASHATTN_TARBALL=%%~fF"
)
if not defined FLASHATTN_TARBALL (
    echo.
    echo [step] Download flash-attn %FLASHATTN_VERSION% source
    >> "%FLASHATTN_LOG%" echo ============================================================
    >> "%FLASHATTN_LOG%" echo [%DATE% %TIME%] Download flash-attn %FLASHATTN_VERSION% source
    >> "%FLASHATTN_LOG%" echo CMD: "%ASCII_VENV_PYTHON%" -m pip download flash-attn==%FLASHATTN_VERSION% --no-deps --no-binary :all: -d "%FLASHATTN_CACHE_DIR%"
    "%ASCII_VENV_PYTHON%" -m pip download flash-attn==%FLASHATTN_VERSION% --no-deps --no-binary :all: -d "%FLASHATTN_CACHE_DIR%" >> "%FLASHATTN_LOG%" 2>&1
    if errorlevel 1 (
        echo [error] Download flash-attn %FLASHATTN_VERSION% source failed. See %FLASHATTN_LOG%
        exit /b 1
    )
    for %%F in ("%FLASHATTN_CACHE_DIR%\flash_attn-%FLASHATTN_VERSION%.*") do (
        if exist "%%~fF" if not defined FLASHATTN_TARBALL set "FLASHATTN_TARBALL=%%~fF"
    )
)
if not defined FLASHATTN_TARBALL (
    echo [error] Could not locate downloaded flash-attn source archive.
    exit /b 1
)

if exist "%FLASHATTN_BUILD_DIR%" rmdir /s /q "%FLASHATTN_BUILD_DIR%"
if exist "%FLASHATTN_BUILD_ROOT%" (
    "%ASCII_VENV_PYTHON%" -c "import shutil, pathlib; target = pathlib.Path(r'%FLASHATTN_BUILD_DIR%'); shutil.rmtree(target, ignore_errors=True)"
)
echo.
echo [step] Extract flash-attn source
>> "%FLASHATTN_LOG%" echo ============================================================
>> "%FLASHATTN_LOG%" echo [%DATE% %TIME%] Extract flash-attn source
>> "%FLASHATTN_LOG%" echo CMD: "%ASCII_VENV_PYTHON%" -c "import shutil; shutil.unpack_archive(r'%FLASHATTN_TARBALL%', r'%FLASHATTN_BUILD_ROOT%')"
"%ASCII_VENV_PYTHON%" -c "import shutil; shutil.unpack_archive(r'%FLASHATTN_TARBALL%', r'%FLASHATTN_BUILD_ROOT%')" >> "%FLASHATTN_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Extract flash-attn source failed. See %FLASHATTN_LOG%
    exit /b 1
)

if not exist "%FLASHATTN_BUILD_DIR%\setup.py" (
    echo [error] Expected source tree missing: %FLASHATTN_BUILD_DIR%\setup.py
    exit /b 1
)

call :patch_flashattn_setup || exit /b 1
call :write_flashattn_runner || exit /b 1

echo.
echo [step] Build flash-attn from source (Windows patch + ASCII path)
>> "%FLASHATTN_LOG%" echo ============================================================
>> "%FLASHATTN_LOG%" echo [%DATE% %TIME%] Build flash-attn from source
cmd /d /c ""%FLASHATTN_RUNNER%"" >> "%FLASHATTN_LOG%" 2>&1
set "FLASHATTN_RC=%ERRORLEVEL%"
if not "%FLASHATTN_RC%"=="0" (
    echo [warn] pip install flash-attn returned %FLASHATTN_RC%. Trying artifact salvage...
    call :install_flashattn_artifacts || exit /b 1
)

"%VENV_PYTHON%" -c "import flash_attn, flash_attn_2_cuda" >nul 2>&1
if errorlevel 1 (
    echo [error] flash-attn import verification failed. See %FLASHATTN_LOG%
    exit /b 1
)
echo [ok] flash-attn is ready.
exit /b 0

:ensure_cuda124_windows
if exist "%CUDA124_HOME%\bin\nvcc.exe" (
    echo [ok] CUDA 12.4 toolkit already present.
    exit /b 0
)
net session >nul 2>&1
if errorlevel 1 (
    echo [error] CUDA 12.4 toolkit is missing and needs Administrator rights to install.
    echo [error] Re-run this script from an elevated Command Prompt.
    exit /b 1
)
if not exist "%CUDA_CACHE_DIR%" mkdir "%CUDA_CACHE_DIR%" >nul 2>&1
if not exist "%CUDA_NET_EXE%" (
    echo.
    echo [step] Download CUDA 12.4.1 network installer
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%CUDA124_URL%' -OutFile '%CUDA_NET_EXE%'"
    if errorlevel 1 (
        echo [error] Failed to download CUDA 12.4.1 network installer.
        exit /b 1
    )
)
if exist "%CUDA_NET_DIR%" rmdir /s /q "%CUDA_NET_DIR%"
mkdir "%CUDA_NET_DIR%" >nul 2>&1

echo.
echo [step] Extract CUDA 12.4.1 installer
>> "%CUDA124_LOG%" echo ============================================================
>> "%CUDA124_LOG%" echo [%DATE% %TIME%] Extract CUDA 12.4.1 installer
tar -xf "%CUDA_NET_EXE%" -C "%CUDA_NET_DIR%" >> "%CUDA124_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Failed to extract CUDA network installer. See %CUDA124_LOG%
    exit /b 1
)
if not exist "%CUDA_NET_DIR%\setup.exe" (
    echo [error] Extracted CUDA installer is missing setup.exe
    exit /b 1
)

echo.
echo [step] Install CUDA 12.4 toolkit only
>> "%CUDA124_LOG%" echo ============================================================
>> "%CUDA124_LOG%" echo [%DATE% %TIME%] Install CUDA 12.4 toolkit only
cmd /d /c ""%CUDA_NET_DIR%\setup.exe" -s %CUDA124_COMPONENTS% -n" >> "%CUDA124_LOG%" 2>&1
if errorlevel 1 (
    echo [error] CUDA 12.4 toolkit install failed. See %CUDA124_LOG%
    exit /b 1
)
if not exist "%CUDA124_HOME%\bin\nvcc.exe" (
    echo [error] CUDA 12.4 install completed but nvcc.exe was not found.
    exit /b 1
)
echo [ok] CUDA 12.4 toolkit ready.
exit /b 0

:find_vcvars64
set "VCVARS64="
set "VSWHERE_EXE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE_EXE%" (
    for /f "usebackq delims=" %%I in (`"%VSWHERE_EXE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars64.bat`) do (
        if not defined VCVARS64 set "VCVARS64=%%~fI"
    )
)
if not defined VCVARS64 if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS64=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS64 (
    echo [error] Could not find vcvars64.bat. Install Visual Studio Build Tools with C++.
    exit /b 1
)
echo [ok] Visual C++ build environment: %VCVARS64%
exit /b 0

:ensure_ascii_root
if defined ASCII_VENV_PYTHON if exist "%ASCII_VENV_PYTHON%" exit /b 0
for %%L in (X Y Z W V U T S R Q P O) do (
    if not defined ASCII_ROOT (
        if exist "%%L:\core-api\video-replace-service\.venv\Scripts\python.exe" (
            set "ASCII_ROOT=%%L:\"
        ) else (
            subst %%L: "%ROOT%" >nul 2>&1
            if exist "%%L:\core-api\video-replace-service\.venv\Scripts\python.exe" set "ASCII_ROOT=%%L:\"
        )
    )
)
if not defined ASCII_ROOT (
    echo [error] Could not create an ASCII alias for %ROOT%
    exit /b 1
)
set "ASCII_SERVICE_DIR=%ASCII_ROOT%core-api\video-replace-service"
set "ASCII_VENV_PYTHON=%ASCII_SERVICE_DIR%\.venv\Scripts\python.exe"
set "ASCII_SITE_PACKAGES=%ASCII_SERVICE_DIR%\.venv\Lib\site-packages"
if not exist "%ASCII_VENV_PYTHON%" (
    echo [error] ASCII alias does not expose the venv Python: %ASCII_VENV_PYTHON%
    exit /b 1
)
echo [ok] ASCII build root: %ASCII_ROOT%
exit /b 0

:patch_flashattn_setup
set "PATCH_SCRIPT=%FLASHATTN_BUILD_ROOT%\patch_flashattn_setup.py"
> "%PATCH_SCRIPT%" echo from pathlib import Path
>> "%PATCH_SCRIPT%" echo path = Path(r"%FLASHATTN_BUILD_DIR%\setup.py")
>> "%PATCH_SCRIPT%" echo text = path.read_text(encoding="utf-8")
>> "%PATCH_SCRIPT%" echo old = '    raw_output = subprocess.check_output([cuda_dir + "/bin/nvcc", "-V"], universal_newlines=True)\n'
>> "%PATCH_SCRIPT%" echo new = '    nvcc_name = "nvcc.exe" if sys.platform == "win32" else "nvcc"\n    nvcc_path = os.path.join(cuda_dir, "bin", nvcc_name)\n    raw_output = subprocess.check_output([nvcc_path, "-V"], universal_newlines=True)\n'
>> "%PATCH_SCRIPT%" echo if 'nvcc.exe' not in text:
>> "%PATCH_SCRIPT%" echo ^    if old not in text:
>> "%PATCH_SCRIPT%" echo ^        raise SystemExit("Could not find the nvcc snippet to patch in setup.py")
>> "%PATCH_SCRIPT%" echo ^    text = text.replace(old, new)
>> "%PATCH_SCRIPT%" echo ^    path.write_text(text, encoding="utf-8")
>> "%PATCH_SCRIPT%" echo print(path)
>> "%FLASHATTN_LOG%" echo ============================================================
>> "%FLASHATTN_LOG%" echo [%DATE% %TIME%] Patch flash-attn setup.py for nvcc.exe
"%ASCII_VENV_PYTHON%" "%PATCH_SCRIPT%" >> "%FLASHATTN_LOG%" 2>&1
if errorlevel 1 (
    echo [error] Failed to patch flash-attn setup.py. See %FLASHATTN_LOG%
    exit /b 1
)
echo [ok] Patched flash-attn setup.py for Windows nvcc.exe.
exit /b 0

:write_flashattn_runner
> "%FLASHATTN_RUNNER%" echo @echo off
>> "%FLASHATTN_RUNNER%" echo setlocal EnableExtensions
>> "%FLASHATTN_RUNNER%" echo call "%VCVARS64%" ^>nul
>> "%FLASHATTN_RUNNER%" echo if errorlevel 1 exit /b 1
>> "%FLASHATTN_RUNNER%" echo set "CUDA_HOME=%CUDA124_HOME%"
>> "%FLASHATTN_RUNNER%" echo set "CUDA_PATH=%CUDA124_HOME%"
>> "%FLASHATTN_RUNNER%" echo set "PATH=%ASCII_SERVICE_DIR%\.venv\Scripts;%CUDA124_HOME%\bin;%%PATH%%"
>> "%FLASHATTN_RUNNER%" echo set "DISTUTILS_USE_SDK=1"
>> "%FLASHATTN_RUNNER%" echo set "MSSdk=1"
>> "%FLASHATTN_RUNNER%" echo set "MAX_JOBS=1"
>> "%FLASHATTN_RUNNER%" echo set "NVCC_THREADS=4"
>> "%FLASHATTN_RUNNER%" echo cd /d "%FLASHATTN_BUILD_DIR%"
>> "%FLASHATTN_RUNNER%" echo "%ASCII_VENV_PYTHON%" -m pip install . --no-build-isolation --no-deps -v
if errorlevel 1 (
    echo [error] Failed to write flash-attn runner script.
    exit /b 1
)
exit /b 0

:install_flashattn_artifacts
set "FLASHATTN_BUILD_LIB="
for /d %%D in ("%FLASHATTN_BUILD_DIR%\build\lib.*") do (
    if not defined FLASHATTN_BUILD_LIB set "FLASHATTN_BUILD_LIB=%%~fD"
)
if not defined FLASHATTN_BUILD_LIB (
    echo [error] Could not locate flash-attn build output under %FLASHATTN_BUILD_DIR%\build
    exit /b 1
)
set "FLASHATTN_PYD="
for %%F in ("%FLASHATTN_BUILD_LIB%\flash_attn_2_cuda*.pyd") do (
    if exist "%%~fF" if not defined FLASHATTN_PYD set "FLASHATTN_PYD=%%~fF"
)
if not defined FLASHATTN_PYD (
    echo [error] Could not locate flash_attn_2_cuda*.pyd in %FLASHATTN_BUILD_LIB%
    exit /b 1
)
if exist "%ASCII_SITE_PACKAGES%\flash_attn" rmdir /s /q "%ASCII_SITE_PACKAGES%\flash_attn"
if exist "%ASCII_SITE_PACKAGES%\hopper" rmdir /s /q "%ASCII_SITE_PACKAGES%\hopper"
if exist "%ASCII_SITE_PACKAGES%\flash_attn.egg-info" rmdir /s /q "%ASCII_SITE_PACKAGES%\flash_attn.egg-info"

xcopy /e /i /y "%FLASHATTN_BUILD_LIB%\flash_attn" "%ASCII_SITE_PACKAGES%\flash_attn" >nul
if errorlevel 1 (
    echo [error] Failed to copy flash_attn package directory.
    exit /b 1
)
if exist "%FLASHATTN_BUILD_LIB%\hopper" (
    xcopy /e /i /y "%FLASHATTN_BUILD_LIB%\hopper" "%ASCII_SITE_PACKAGES%\hopper" >nul
    if errorlevel 1 (
        echo [error] Failed to copy hopper package directory.
        exit /b 1
    )
)
copy /y "%FLASHATTN_PYD%" "%ASCII_SITE_PACKAGES%\" >nul
if errorlevel 1 (
    echo [error] Failed to copy flash_attn_2_cuda module.
    exit /b 1
)
if exist "%FLASHATTN_BUILD_LIB%\flash_attn.egg-info" (
    xcopy /e /i /y "%FLASHATTN_BUILD_LIB%\flash_attn.egg-info" "%ASCII_SITE_PACKAGES%\flash_attn.egg-info" >nul
    if errorlevel 1 (
        echo [error] Failed to copy flash_attn.egg-info.
        exit /b 1
    )
)
echo [ok] Salvaged flash-attn artifacts into site-packages.
exit /b 0
