// src/widgets/plcBinding.jsx
//
// Shared "which PLC address does this widget use" editor.
//
// Pick the PROTOCOL first, then a device of that protocol, and the fields below adapt:
//   Modbus TCP / RTU  ->  Address Type (Coil / Discrete Input / Holding / Input) + Address
//   Omron FINS        ->  Memory Area (DM / CIO / ...) + Address (100 / 10.03) + Data Type
//   EtherNet/IP       ->  Tag + Data Type
//
// It edits a widget's existing props (device / addressType / address) plus an optional
// dataType, so widgets saved before this existed keep working unchanged.

import { useState } from "react";
import { PropInput } from "./shared";
import {
  PLC_PROTOCOLS,
  TAG_ADDRESS_TYPE,
  addressKind,
  addressPlaceholder,
  addressTypeOptions,
  dataTypeOptions,
  defaultAddressType,
  devicesOfProtocol,
  findDevice,
  isAddressTypeValidFor,
  normalizeFinsArea,
  protocolOf,
  useCommDevices,
} from "../lib/comm";

const inferProtocolFromAddressType = (addressType) => {
  if (normalizeFinsArea(addressType)) return "fins";
  if (String(addressType ?? "") === TAG_ADDRESS_TYPE) return "ethernet_ip";
  return "modbus_tcp";
};

/**
 * @param value               { device, addressType, address, dataType }
 * @param onSet(patch)        receives a partial { device?, addressType?, address?, dataType? }
 * @param allowedModbusTypes  optional list of Modbus address types this widget may use
 * @param protocols           optional list of protocol ids to offer (default: all PLC protocols)
 * @param labels              optional { device, address, addressType } caption overrides
 * @param showDataType        false to hide the Data Type field (FINS / EtherNet/IP)
 * @param inline              true = single column (for narrow editors such as per-row dialogs)
 */
export function PlcBindingFields({
  value = {},
  onSet,
  allowedModbusTypes,
  protocols,
  labels = {},
  showDataType = true,
  inline = false,
}) {
  const devices = useCommDevices();
  const [pickedProtocol, setPickedProtocol] = useState("modbus_tcp");

  const offered = Array.isArray(protocols) && protocols.length
    ? PLC_PROTOCOLS.filter((p) => protocols.includes(p.id))
    : PLC_PROTOCOLS;

  const selectedDevice = findDevice(devices, value.device);
  const protocol = selectedDevice
    ? protocolOf(selectedDevice)
    : value.device
      ? inferProtocolFromAddressType(value.addressType)
      : pickedProtocol;

  const kind = addressKind(protocol);
  const deviceOptions = devicesOfProtocol(devices, protocol);
  const addressTypes = addressTypeOptions(protocol, allowedModbusTypes);
  const dataTypes = showDataType ? dataTypeOptions(protocol) : null;

  const addressTypeValid = isAddressTypeValidFor(protocol, value.addressType, allowedModbusTypes);
  const shownAddressType = kind === "fins"
    ? normalizeFinsArea(value.addressType)
    : addressTypeValid
      ? value.addressType
      : "";

  const handleProtocol = (next) => {
    setPickedProtocol(next);
    onSet({
      device: "",
      address: "",
      addressType: defaultAddressType(next, allowedModbusTypes),
      dataType: "",
    });
  };

  const handleDevice = (name) => {
    const patch = { device: name };
    if (name && !addressTypeValid) patch.addressType = defaultAddressType(protocol, allowedModbusTypes);
    onSet(patch);
  };

  const grid = inline ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2";

  return (
    <div className="flex flex-col gap-2">
      <div className={grid}>
        <PropInput
          label="Protocol"
          options={offered.map((p) => ({ value: p.id, label: p.label }))}
          value={offered.some((p) => p.id === protocol) ? protocol : ""}
          onChange={handleProtocol}
        />

        <PropInput
          label={labels.device || "Device"}
          options={[
            { value: "", label: "Select device..." },
            // keep a saved device visible even if it is currently unreachable / removed
            ...(value.device && !deviceOptions.some((d) => d.name === value.device)
              ? [{ value: value.device, label: `${value.device} (not found)` }]
              : []),
            ...deviceOptions.map((d) => ({
              value: d.name,
              label: `${d.name}${d.connected === false ? " (offline)" : ""}`,
            })),
          ]}
          value={value.device ?? ""}
          onChange={handleDevice}
        />
      </div>

      {kind === "tag" ? (
        <PropInput
          label={labels.address || "Tag"}
          value={value.address ?? ""}
          onChange={(v) => onSet({ address: v, addressType: TAG_ADDRESS_TYPE })}
          placeholder={addressPlaceholder(protocol)}
        />
      ) : (
        <div className={grid}>
          <PropInput
            label={labels.addressType || (kind === "fins" ? "Memory Area" : "Address Type")}
            options={[...(shownAddressType ? [] : [{ value: "", label: "Select..." }]), ...addressTypes]}
            value={shownAddressType}
            onChange={(v) => onSet({ addressType: v })}
          />
          <PropInput
            label={labels.address || "Address"}
            value={value.address ?? ""}
            onChange={(v) => onSet({ address: v })}
            placeholder={addressPlaceholder(protocol)}
          />
        </div>
      )}

      {dataTypes && (
        <PropInput
          label="Data Type"
          options={dataTypes}
          value={value.dataType ?? ""}
          onChange={(v) => onSet({ dataType: v })}
        />
      )}
    </div>
  );
}

export default PlcBindingFields;

/**
 * Rename the keys of a PlcBindingFields patch to a widget's own prop names, e.g.
 *   mapPatch({ device: "PLC1" }, { device: "triggerDevice" })  ->  { triggerDevice: "PLC1" }
 */
export const mapPatch = (patch, names) =>
  Object.fromEntries(Object.entries(patch).map(([key, value]) => [names[key] || key, value]));
