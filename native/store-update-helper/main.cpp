#include <windows.h>
#include <shobjidl_core.h>

#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Services.Store.h>
#include <winrt/base.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {
using winrt::Windows::ApplicationModel::Package;
using winrt::Windows::Foundation::AsyncStatus;
using winrt::Windows::Services::Store::StoreContext;
using winrt::Windows::Services::Store::StorePackageUpdate;
using winrt::Windows::Services::Store::StorePackageUpdateResult;
using winrt::Windows::Services::Store::StorePackageUpdateState;
using winrt::Windows::Services::Store::StorePackageUpdateStatus;

constexpr std::wstring_view kExpectedPackageName = L"Gantrol.AIY";
constexpr int kProtocolVersion = 1;

class HelperError final : public std::runtime_error {
 public:
  HelperError(std::string code, bool retryable)
      : std::runtime_error(code), code_(std::move(code)), retryable_(retryable) {}

  [[nodiscard]] const std::string& code() const noexcept { return code_; }
  [[nodiscard]] bool retryable() const noexcept { return retryable_; }

 private:
  std::string code_;
  bool retryable_;
};

void EmitLine(const std::string& line) {
  std::cout << line << '\n';
  std::cout.flush();
}

void EmitError(const std::string& code, bool retryable) {
  EmitLine("{\"type\":\"error\",\"code\":\"" + code + "\",\"retryable\":" +
           (retryable ? "true" : "false") + "}");
}

std::string HresultCode(winrt::hresult value) {
  std::ostringstream stream;
  stream << "HRESULT_" << std::uppercase << std::hex << std::setw(8) << std::setfill('0')
         << static_cast<std::uint32_t>(value);
  return stream.str();
}

template <typename TAsyncOperation>
auto WaitWithMessagePump(const TAsyncOperation& operation) -> decltype(operation.GetResults()) {
  while (operation.Status() == AsyncStatus::Started) {
    const DWORD wait_result =
        MsgWaitForMultipleObjectsEx(0, nullptr, 50, QS_ALLINPUT, MWMO_INPUTAVAILABLE | MWMO_ALERTABLE);
    if (wait_result == WAIT_FAILED) {
      winrt::throw_last_error();
    }

    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  return operation.GetResults();
}

std::uint64_t ParseWindowHandle(std::wstring_view value) {
  if (value.empty()) throw HelperError("STORE_WINDOW_HANDLE_INVALID", false);
  std::uint64_t result = 0;
  for (const wchar_t character : value) {
    if (character < L'0' || character > L'9') throw HelperError("STORE_WINDOW_HANDLE_INVALID", false);
    const auto digit = static_cast<std::uint64_t>(character - L'0');
    if (result > (std::numeric_limits<std::uint64_t>::max() - digit) / 10) {
      throw HelperError("STORE_WINDOW_HANDLE_INVALID", false);
    }
    result = result * 10 + digit;
  }
  if (result == 0 || result > std::numeric_limits<std::uintptr_t>::max()) {
    throw HelperError("STORE_WINDOW_HANDLE_INVALID", false);
  }
  return result;
}

HWND ParseAndValidateWindowHandle(std::wstring_view value) {
  const auto numeric_handle = ParseWindowHandle(value);
  const auto window = reinterpret_cast<HWND>(static_cast<std::uintptr_t>(numeric_handle));
  if (!IsWindow(window)) throw HelperError("STORE_WINDOW_UNAVAILABLE", true);
  return window;
}

StoreContext CreateStoreContext(HWND owner_window = nullptr) {
  const Package current_package = Package::Current();
  if (current_package.Id().Name() != kExpectedPackageName) {
    throw HelperError("STORE_PACKAGE_IDENTITY_MISMATCH", false);
  }

  StoreContext context = StoreContext::GetDefault();
  if (owner_window != nullptr) {
    const auto initialize_with_window = context.as<IInitializeWithWindow>();
    winrt::check_hresult(initialize_with_window->Initialize(owner_window));
  }
  return context;
}

struct CurrentPackageUpdates {
  std::vector<StorePackageUpdate> updates;
};

CurrentPackageUpdates GetCurrentPackageUpdates(const StoreContext& context) {
  CurrentPackageUpdates selected;
  const auto available_updates = WaitWithMessagePump(context.GetAppAndOptionalStorePackageUpdatesAsync());
  for (const StorePackageUpdate& update : available_updates) {
    const auto package = update.Package();
    if (package.Id().Name() != kExpectedPackageName) continue;
    selected.updates.push_back(update);
  }
  return selected;
}

const char* StateName(StorePackageUpdateState state) {
  switch (state) {
    case StorePackageUpdateState::Pending:
      return "PENDING";
    case StorePackageUpdateState::Downloading:
      return "DOWNLOADING";
    case StorePackageUpdateState::Deploying:
      return "DEPLOYING";
    case StorePackageUpdateState::Completed:
      return "COMPLETED";
    case StorePackageUpdateState::Canceled:
      return "CANCELED";
    case StorePackageUpdateState::OtherError:
      return "OTHER_ERROR";
    case StorePackageUpdateState::ErrorLowBattery:
      return "LOW_BATTERY";
    case StorePackageUpdateState::ErrorWiFiRecommended:
      return "WIFI_RECOMMENDED";
    case StorePackageUpdateState::ErrorWiFiRequired:
      return "WIFI_REQUIRED";
  }
  return "UNKNOWN";
}

class ProgressReporter {
 public:
  explicit ProgressReporter(std::string operation) : operation_(std::move(operation)) {}

  void operator()(const StorePackageUpdateStatus& status) {
    const double raw_progress = std::isfinite(status.TotalDownloadProgress) ? status.TotalDownloadProgress : 0.0;
    const int percent = static_cast<int>(std::round(std::clamp(raw_progress, 0.0, 1.0) * 100.0));
    const auto state = status.PackageUpdateState;

    std::scoped_lock lock(mutex_);
    if (percent == last_percent_ && state == last_state_) return;
    last_percent_ = percent;
    last_state_ = state;

    std::ostringstream stream;
    stream << "{\"type\":\"progress\",\"operation\":\"" << operation_ << "\",\"percent\":" << percent
           << ",\"transferred\":" << status.PackageBytesDownloaded << ",\"total\":"
           << status.PackageDownloadSizeInBytes << ",\"state\":\"" << StateName(state) << "\"}";
    EmitLine(stream.str());
  }

 private:
  std::string operation_;
  std::mutex mutex_;
  int last_percent_ = -1;
  StorePackageUpdateState last_state_ = static_cast<StorePackageUpdateState>(-1);
};

[[noreturn]] void ThrowForOperationState(StorePackageUpdateState state) {
  switch (state) {
    case StorePackageUpdateState::Canceled:
      throw HelperError("STORE_OPERATION_CANCELED", true);
    case StorePackageUpdateState::ErrorLowBattery:
      throw HelperError("STORE_LOW_BATTERY", true);
    case StorePackageUpdateState::ErrorWiFiRecommended:
      throw HelperError("STORE_WIFI_RECOMMENDED", true);
    case StorePackageUpdateState::ErrorWiFiRequired:
      throw HelperError("STORE_WIFI_REQUIRED", true);
    case StorePackageUpdateState::OtherError:
      throw HelperError("STORE_OPERATION_FAILED", true);
    default:
      throw HelperError("STORE_OPERATION_INCOMPLETE", true);
  }
}

void ValidateOperationResult(const StorePackageUpdateResult& result) {
  if (result.OverallState() == StorePackageUpdateState::Completed) return;
  ThrowForOperationState(result.OverallState());
}

void RunCheck() {
  const auto selected = GetCurrentPackageUpdates(CreateStoreContext());
  if (selected.updates.empty()) {
    EmitLine("{\"type\":\"check-result\",\"available\":false}");
    return;
  }
  EmitLine("{\"type\":\"check-result\",\"available\":true}");
}

void RunUpdateOperation(const std::string& operation_name, HWND owner_window) {
  const auto context = CreateStoreContext(owner_window);
  auto selected = GetCurrentPackageUpdates(context);
  if (selected.updates.empty()) throw HelperError("STORE_UPDATE_NO_LONGER_AVAILABLE", true);

  ProgressReporter reporter(operation_name);
  if (operation_name == "DOWNLOAD") {
    const auto operation = context.RequestDownloadStorePackageUpdatesAsync(std::move(selected.updates));
    operation.Progress([&reporter](const auto&, const StorePackageUpdateStatus& status) { reporter(status); });
    ValidateOperationResult(WaitWithMessagePump(operation));
  } else {
    const auto operation = context.RequestDownloadAndInstallStorePackageUpdatesAsync(std::move(selected.updates));
    operation.Progress([&reporter](const auto&, const StorePackageUpdateStatus& status) { reporter(status); });
    ValidateOperationResult(WaitWithMessagePump(operation));
  }
  EmitLine("{\"type\":\"operation-result\",\"operation\":\"" + operation_name +
           "\",\"status\":\"COMPLETED\"}");
}

HWND RequireWindowHandle(int argc, wchar_t* argv[]) {
  if (argc != 4 || std::wstring_view(argv[2]) != L"--window-handle") {
    throw HelperError("STORE_COMMAND_INVALID", false);
  }
  return ParseAndValidateWindowHandle(argv[3]);
}
}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  try {
    if (argc == 2 && std::wstring_view(argv[1]) == L"protocol-version") {
      EmitLine("{\"type\":\"protocol\",\"version\":" + std::to_string(kProtocolVersion) + "}");
      return 0;
    }

    winrt::init_apartment(winrt::apartment_type::single_threaded);
    if (argc == 2 && std::wstring_view(argv[1]) == L"check") {
      RunCheck();
      return 0;
    }
    if (argc >= 2 && std::wstring_view(argv[1]) == L"download") {
      RunUpdateOperation("DOWNLOAD", RequireWindowHandle(argc, argv));
      return 0;
    }
    if (argc >= 2 && std::wstring_view(argv[1]) == L"install") {
      RunUpdateOperation("INSTALL", RequireWindowHandle(argc, argv));
      return 0;
    }
    throw HelperError("STORE_COMMAND_INVALID", false);
  } catch (const HelperError& error) {
    EmitError(error.code(), error.retryable());
  } catch (const winrt::hresult_error& error) {
    EmitError(HresultCode(error.code()), true);
  } catch (...) {
    EmitError("STORE_HELPER_FAILURE", false);
  }
  return 1;
}
