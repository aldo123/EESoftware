// src/hooks/useTCPPLC.js

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { API } from "../service/api";

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_POLL_INTERVAL = 300;


// ============================================================
// NORMALIZE ADDRESS TYPE
// ============================================================

function normalizeAddressType(type) {
  const value = String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]/g, "");

  switch (value) {
    case "coil":
    case "coils":
      return "coil";

    case "discreteinput":
    case "discreteinputs":
    case "digitalinput":
      return "discrete_input";

    case "holdingregister":
    case "holdingregisters":
    case "holding":
      return "holding_register";

    case "inputregister":
    case "inputregisters":
    case "analoginput":
      return "input_register";

    default:
      return "";
  }
}


// ============================================================
// NORMALIZE DEVICE
// ============================================================

function normalizeDevice(device) {
  if (!device) {
    return null;
  }

  const name =
    device.name ||
    device.deviceName ||
    device["Device Name"] ||
    device.id ||
    "";

  const host =
    device.host ||
    device.ip ||
    device.IP ||
    device["IP Address"] ||
    device.address ||
    device.hostname ||
    "";

  const port =
    Number(
      device.port ||
      device.Port ||
      device.tcpPort ||
      502
    ) || 502;

  const unitId =
    Number(
      device.unitId ??
      device.unit_id ??
      device["Device ID"] ??
      device["Unit ID"] ??
      device.slaveId ??
      1
    ) || 1;

  return {
    ...device,
    name: String(name),
    host: String(host),
    port,
    unitId,
  };
}


// ============================================================
// ADDRESS KEY
// ============================================================

function createAddressKey(
  device,
  addressType,
  address
) {
  const d = normalizeDevice(device);

  const type =
    normalizeAddressType(addressType);

  return [
    d?.name || "",
    d?.host || "",
    d?.port || 502,
    d?.unitId || 1,
    type,
    Number(address),
  ].join(":");
}


// ============================================================
// HOOK
// ============================================================

export function useTCPPLC({
  devices = [],
  enabled = true,
  pollInterval = DEFAULT_POLL_INTERVAL,
} = {}) {

  // ==========================================================
  // STATE
  // ==========================================================

  const [values, setValues] = useState({});

  const [connectionStatus, setConnectionStatus] =
    useState({});

  const [errors, setErrors] =
    useState({});


  // State snapshots used by the batch poller. The poll cycle
  // commits all PLC results with one React state update.
  const valuesRef =
    useRef({});

  const connectionStatusRef =
    useRef({});

  const errorsRef =
    useRef({});


  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    connectionStatusRef.current =
      connectionStatus;
  }, [connectionStatus]);

  useEffect(() => {
    errorsRef.current = errors;
  }, [errors]);


  // ==========================================================
  // REFS
  // ==========================================================

  const bindingsRef =
    useRef(new Map());

  const timerRef =
    useRef(null);

  const mountedRef =
    useRef(false);

  const busyRef =
    useRef(false);


  // ==========================================================
  // COMPONENT CAPABILITY
  // ==========================================================
  //
  // BUTTON
  //   WRITE:
  //     Coil
  //     Holding Register
  //
  // LIGHT
  //   READ:
  //     Coil
  //     Discrete Input
  //     Holding Register
  //     Input Register
  //
  // GAUGE
  //   READ:
  //     Holding Register
  //
  // LINE CHART
  //   READ:
  //     Coil
  //     Discrete Input
  //     Holding Register
  //     Input Register
  //
  // ==========================================================

  function isValidBinding(
    widgetType,
    addressType
  ) {

    const type =
      normalizeAddressType(addressType);

    const component =
      String(widgetType || "")
        .trim()
        .toLowerCase();


    // --------------------------------------------------------
    // BUTTON
    // --------------------------------------------------------

    if (component === "button") {
      return (
        type === "coil" ||
        type === "holding_register"
      );
    }


    // --------------------------------------------------------
    // LIGHT
    // --------------------------------------------------------

    if (component === "light") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }


    // --------------------------------------------------------
    // GAUGE
    // --------------------------------------------------------

    if (component === "gauge") {
      return (
        type === "holding_register"
      );
    }


    // --------------------------------------------------------
    // LINE CHART
    // --------------------------------------------------------

    // --------------------------------------------------------
    // TEXT BOX
    // --------------------------------------------------------
    // TextBox is READ ONLY for TCP/IP + Realtime.
    // DynamicCPPage decides whether the TextBox is configured as
    // TCP/IP + Realtime before registering the binding.
    if (component === "textbox") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }

    if (component === "linechart") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }


    // --------------------------------------------------------
    // TEST TABLE
    // --------------------------------------------------------
    // Test Table is READ ONLY when it is configured as
    // TCP/IP + Realtime.
    //
    // Each Test Table row is registered independently by
    // DynamicCPPage using:
    //
    //   widgetId   = `${tableId}:${rowId}`
    //   widgetType = "testtable"
    //
    // All Modbus read types are supported.
    if (component === "testtable") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }


    return false;
  }


  // ==========================================================
  // REGISTER BINDING
  // ==========================================================

  const registerBinding =
    useCallback(
      ({
        widgetId,
        widgetType,
        device,
        addressType,
        address,
      }) => {

        if (!widgetId) {
          return;
        }

        if (!device) {
          console.warn(
            `[useTCPPLC] Device missing for ${widgetId}`
          );

          return;
        }


        const normalizedDevice =
          normalizeDevice(device);


        if (!normalizedDevice?.name) {
          console.warn(
            `[useTCPPLC] Device name missing for ${widgetId}`
          );

          return;
        }


        if (!normalizedDevice?.host) {
          console.warn(
            `[useTCPPLC] Device host/IP missing for ${widgetId}`
          );

          return;
        }


        const numericAddress =
          Number(address);


        if (!Number.isFinite(numericAddress)) {
          console.warn(
            `[useTCPPLC] Invalid address for ${widgetId}:`,
            address
          );

          return;
        }


        const type =
          normalizeAddressType(
            addressType
          );


        if (!type) {
          console.warn(
            `[useTCPPLC] Invalid address type for ${widgetId}:`,
            addressType
          );

          return;
        }


        // ------------------------------------------------------
        // CAPABILITY CHECK
        // ------------------------------------------------------

        if (
          !isValidBinding(
            widgetType,
            type
          )
        ) {

          console.warn(
            `[useTCPPLC] Invalid binding: ${widgetType} cannot use ${type}`
          );

          return;
        }


        // ------------------------------------------------------
        // PHYSICAL ADDRESS KEY
        // ------------------------------------------------------

        const key =
          createAddressKey(
            normalizedDevice,
            type,
            numericAddress
          );


        const normalizedWidgetType =
          String(widgetType || "")
            .trim()
            .toLowerCase();


        // ------------------------------------------------------
        // SAVE
        // ------------------------------------------------------

        bindingsRef.current.set(
          String(widgetId),
          {
            widgetId:
              String(widgetId),

            widgetType:
              normalizedWidgetType,

            device:
              normalizedDevice,

            addressType:
              type,

            address:
              numericAddress,

            key,
          }
        );


        console.debug(
          `[useTCPPLC] Binding registered: ${widgetId} -> ${normalizedDevice.name} / ${type} / ${numericAddress}`
        );

        if (normalizedWidgetType === "textbox") {
          console.debug(
            `[useTCPPLC] TextBox TCP realtime binding ready: ${widgetId} -> ${normalizedDevice.name} / ${type} / ${numericAddress}`
          );
        }

      },
      []
    );


  // ==========================================================
  // UNREGISTER
  // ==========================================================

  const unregisterBinding =
    useCallback(
      (widgetId) => {

        if (!widgetId) {
          return;
        }

        bindingsRef.current.delete(
          String(widgetId)
        );

      },
      []
    );


  // ==========================================================
  // CLEAR BINDINGS
  // ==========================================================

  const clearBindings =
    useCallback(
      () => {

        bindingsRef.current.clear();

      },
      []
    );


  // ==========================================================
  // READ PLC
  // ==========================================================

  const readPLC =
    useCallback(
      async ({
        device,
        addressType,
        address,
        count = 1,
      }) => {

        const normalizedDevice =
          normalizeDevice(device);


        if (!normalizedDevice) {
          throw new Error(
            "PLC device is not configured."
          );
        }


        if (!normalizedDevice.name) {
          throw new Error(
            "PLC device name is missing."
          );
        }


        if (!normalizedDevice.host) {
          throw new Error(
            `PLC IP address is missing for ${normalizedDevice.name}.`
          );
        }


        const type =
          normalizeAddressType(
            addressType
          );


        if (!type) {
          throw new Error(
            "Invalid Modbus address type."
          );
        }


        const numericAddress =
          Number(address);


        if (!Number.isFinite(numericAddress)) {
          throw new Error(
            "Modbus address must be a number."
          );
        }


        const numericCount =
          Number(count) || 1;


        // ------------------------------------------------------
        // REQUEST
        // ------------------------------------------------------

        const response =
          await fetch(
            `${API}/api/tcp/read`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({

                device_name:
                  normalizedDevice.name,

                address_type:
                  type,

                address:
                  numericAddress,

                count:
                  numericCount,

              }),
            }
          );


        // ------------------------------------------------------
        // HTTP ERROR
        // ------------------------------------------------------

        if (!response.ok) {

          let message =
            `PLC read HTTP ${response.status}`;


          try {

            const errorData =
              await response.json();


            if (errorData?.message) {
              message =
                errorData.message;
            }

          } catch {
            // Ignore JSON error.
          }


          throw new Error(message);
        }


        // ------------------------------------------------------
        // RESPONSE
        // ------------------------------------------------------

        const data =
          await response.json();


        if (!data.success) {

          throw new Error(
            data.message ||
            "PLC read failed."
          );

        }


        // ------------------------------------------------------
        // VALUE
        // ------------------------------------------------------

        if (
          data.value !== undefined
        ) {

          return data.value;

        }


        if (
          Array.isArray(
            data.values
          )
        ) {

          return data.values;

        }


        return null;

      },
      []
    );



  // ==========================================================
  // BATCH READ PLC
  // ==========================================================

  const readBatchPLC =
    useCallback(
      async ({
        device,
        requests,
      }) => {

        const normalizedDevice =
          normalizeDevice(device);

        if (!normalizedDevice) {
          throw new Error(
            "PLC device is not configured."
          );
        }

        if (!normalizedDevice.name) {
          throw new Error(
            "PLC device name is missing."
          );
        }

        if (
          !Array.isArray(requests) ||
          requests.length === 0
        ) {
          return [];
        }

        const normalizedRequests =
          requests.map(
            (item, index) => {

              const type =
                normalizeAddressType(
                  item.addressType
                );

              if (!type) {
                throw new Error(
                  `Invalid Modbus address type for request ${index}.`
                );
              }

              const numericAddress =
                Number(item.address);

              if (
                !Number.isInteger(
                  numericAddress
                ) ||
                numericAddress < 0 ||
                numericAddress > 65535
              ) {
                throw new Error(
                  `Invalid Modbus address for request ${index}.`
                );
              }

              return {
                id:
                  String(
                    item.id ??
                    `${type}:${numericAddress}:${index}`
                  ),

                addressType:
                  type,

                address:
                  numericAddress,
              };

            }
          );

        const response =
          await fetch(
            `${API}/api/tcp/read-batch`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  device_name:
                    normalizedDevice.name,

                  requests:
                    normalizedRequests.map(
                      (item) => ({
                        id:
                          item.id,

                        address_type:
                          item.addressType,

                        address:
                          item.address,
                      })
                    ),
                }),
            }
          );

        if (!response.ok) {

          let message =
            `PLC batch read HTTP ${response.status}`;

          try {
            const errorData =
              await response.json();

            if (errorData?.message) {
              message =
                errorData.message;
            }
          } catch {
            // Ignore invalid error JSON.
          }

          throw new Error(message);
        }

        const data =
          await response.json();

        if (!data.success) {
          throw new Error(
            data.message ||
            "PLC batch read failed."
          );
        }

        return Array.isArray(data.results)
          ? data.results
          : [];

      },
      []
    );



  // ==========================================================
  // WRITE PLC
  // ==========================================================

  const writePLC =
    useCallback(
      async ({
        device,
        addressType,
        address,
        value,
      }) => {

        const normalizedDevice =
          normalizeDevice(device);


        if (!normalizedDevice) {
          throw new Error(
            "PLC device is not configured."
          );
        }


        if (!normalizedDevice.name) {
          throw new Error(
            "PLC device name is missing."
          );
        }


        const type =
          normalizeAddressType(
            addressType
          );


        // ------------------------------------------------------
        // ONLY WRITEABLE TYPES
        // ------------------------------------------------------

        if (
          type !== "coil" &&
          type !== "holding_register"
        ) {

          throw new Error(
            `${type || "Address"} is read-only.`
          );

        }


        const numericAddress =
          Number(address);


        if (!Number.isFinite(numericAddress)) {

          throw new Error(
            "Modbus address must be a number."
          );

        }


        // ------------------------------------------------------
        // VALUE
        // ------------------------------------------------------

        let writeValueData;


        if (
          type === "coil"
        ) {

          writeValueData =
            (
              value === true ||
              Number(value) === 1
            );

        } else {

          writeValueData =
            Number(value);

        }


        // ------------------------------------------------------
        // REQUEST
        // ------------------------------------------------------

        const response =
          await fetch(
            `${API}/api/tcp/write`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({

                device_name:
                  normalizedDevice.name,

                address_type:
                  type,

                address:
                  numericAddress,

                value:
                  writeValueData,

              }),
            }
          );


        // ------------------------------------------------------
        // HTTP ERROR
        // ------------------------------------------------------

        if (!response.ok) {

          let message =
            `PLC write HTTP ${response.status}`;


          try {

            const errorData =
              await response.json();


            if (errorData?.message) {
              message =
                errorData.message;
            }

          } catch {
            // Ignore.
          }


          throw new Error(message);

        }


        const data =
          await response.json();


        if (!data.success) {

          throw new Error(
            data.message ||
            "PLC write failed."
          );

        }


        return data;

      },
      []
    );


  // ==========================================================
  // POLL PLC
  // ==========================================================

  const poll =
    useCallback(
      async () => {

        if (!enabled) {
          return;
        }

        if (busyRef.current) {
          return;
        }

        if (
          bindingsRef.current.size === 0
        ) {
          return;
        }

        busyRef.current = true;

        try {

          // ----------------------------------------------------
          // GROUP BY UNIQUE PHYSICAL ADDRESS
          // ----------------------------------------------------

          const grouped =
            new Map();

          bindingsRef.current.forEach(
            (binding) => {

              const component =
                String(
                  binding.widgetType || ""
                )
                  .trim()
                  .toLowerCase();

              // Buttons are write-only.
              if (component === "button") {
                return;
              }

              const normalizedDevice =
                normalizeDevice(
                  binding.device
                );

              if (!normalizedDevice?.name) {
                return;
              }

              const addressType =
                normalizeAddressType(
                  binding.addressType
                );

              const numericAddress =
                Number(binding.address);

              if (
                !addressType ||
                !Number.isInteger(
                  numericAddress
                ) ||
                numericAddress < 0 ||
                numericAddress > 65535
              ) {
                return;
              }

              const key =
                createAddressKey(
                  normalizedDevice,
                  addressType,
                  numericAddress
                );

              if (!grouped.has(key)) {
                grouped.set(
                  key,
                  {
                    key,
                    device:
                      normalizedDevice,
                    addressType,
                    address:
                      numericAddress,
                    bindings: [],
                  }
                );
              }

              grouped
                .get(key)
                .bindings
                .push(binding);

            }
          );


          // ----------------------------------------------------
          // GROUP PHYSICAL ADDRESSES BY TCP DEVICE
          //
          // One HTTP request per device. The backend turns
          // contiguous addresses into one Modbus transaction.
          // ----------------------------------------------------

          const deviceBatches =
            new Map();

          grouped.forEach(
            (group) => {

              const device =
                group.device;

              const deviceKey =
                [
                  device.name,
                  device.host,
                  device.port,
                  device.unitId,
                ].join(":");

              if (!deviceBatches.has(deviceKey)) {
                deviceBatches.set(
                  deviceKey,
                  {
                    device,
                    groups: [],
                  }
                );
              }

              deviceBatches
                .get(deviceKey)
                .groups
                .push(group);

            }
          );


          const nextValues = {
            ...(valuesRef.current || {}),
          };

          const nextStatus = {
            ...(connectionStatusRef.current || {}),
          };

          const nextErrors = {
            ...(errorsRef.current || {}),
          };


          await Promise.all(
            Array.from(
              deviceBatches.values()
            ).map(
              async (batch) => {

                try {

                  const results =
                    await readBatchPLC({
                      device:
                        batch.device,

                      requests:
                        batch.groups.map(
                          (group) => ({
                            id:
                              group.key,

                            addressType:
                              group.addressType,

                            address:
                              group.address,
                          })
                        ),
                    });


                  const resultMap =
                    new Map(
                      results.map(
                        (result) => [
                          String(result.id),
                          result,
                        ]
                      )
                    );


                  for (
                    const group
                    of batch.groups
                  ) {

                    const result =
                      resultMap.get(
                        String(group.key)
                      );

                    if (
                      !result ||
                      result.success === false
                    ) {

                      nextStatus[
                        group.key
                      ] = false;

                      nextErrors[
                        group.key
                      ] =
                        result?.message ||
                        "PLC communication error.";

                      continue;
                    }


                    const value =
                      result.value;


                    nextStatus[
                      group.key
                    ] = true;

                    delete nextErrors[
                      group.key
                    ];


                    nextValues[
                      group.key
                    ] = value;


                    for (
                      const binding
                      of group.bindings
                    ) {

                      nextValues[
                        binding.widgetId
                      ] = value;

                    }

                  }

                } catch (error) {

                  if (
                    !mountedRef.current
                  ) {
                    return;
                  }

                  for (
                    const group
                    of batch.groups
                  ) {

                    nextStatus[
                      group.key
                    ] = false;

                    nextErrors[
                      group.key
                    ] =
                      error?.message ||
                      "PLC communication error.";

                  }

                  console.error(
                    `[useTCPPLC] Batch read failed: ${batch.device?.name}`,
                    error
                  );

                }

              }
            )
          );


          if (
            !mountedRef.current
          ) {
            return;
          }


          // ----------------------------------------------------
          // ONE REACT STATE COMMIT PER POLL CYCLE
          // ----------------------------------------------------

          valuesRef.current =
            nextValues;

          connectionStatusRef.current =
            nextStatus;

          errorsRef.current =
            nextErrors;

          setValues(
            nextValues
          );

          setConnectionStatus(
            nextStatus
          );

          setErrors(
            nextErrors
          );

        } finally {

          busyRef.current =
            false;

        }

      },
      [
        enabled,
        readBatchPLC,
      ]
    );


  // ==========================================================
  // AUTO POLLING
  // ==========================================================

  useEffect(
    () => {

      mountedRef.current =
        true;


      if (!enabled) {

        return () => {

          mountedRef.current =
            false;

        };

      }


      // --------------------------------------------------------
      // IMMEDIATE READ
      // --------------------------------------------------------

      poll();


      // --------------------------------------------------------
      // INTERVAL
      // --------------------------------------------------------

      timerRef.current =
        setInterval(
          poll,
          Math.max(
            100,
            Number(
              pollInterval
            ) ||
            DEFAULT_POLL_INTERVAL
          )
        );


      // --------------------------------------------------------
      // CLEANUP
      // --------------------------------------------------------

      return () => {

        mountedRef.current =
          false;


        if (
          timerRef.current
        ) {

          clearInterval(
            timerRef.current
          );

          timerRef.current =
            null;

        }

      };

    },
    [
      enabled,
      poll,
      pollInterval,
    ]
  );


  // ==========================================================
  // WRITE VALUE
  // ==========================================================

  const writeValue =
    useCallback(
      async ({
        widgetId,
        device,
        addressType,
        address,
        value,
      }) => {

        const result =
          await writePLC({

            device,
            addressType,
            address,
            value,

          });


        // ------------------------------------------------------
        // Optimistic UI update
        //
        // Nilai akan tetap dikoreksi oleh polling PLC.
        // ------------------------------------------------------

        if (
          mountedRef.current
        ) {

          const normalizedDevice =
            normalizeDevice(
              device
            );


          const type =
            normalizeAddressType(
              addressType
            );


          const key =
            createAddressKey(
              normalizedDevice,
              type,
              address
            );


          // ----------------------------------------------------
          // IMPORTANT:
          //
          // Write value juga langsung diberikan ke SEMUA widget
          // yang menggunakan address yang sama.
          //
          // Polling PLC kemudian akan menjadi source of truth.
          // ----------------------------------------------------

          setValues(
            (previous) => {

              const next = {
                ...previous,

                [key]:
                  value,

              };


              bindingsRef.current.forEach(
                (binding) => {

                  if (
                    binding.key === key
                  ) {

                    next[
                      binding.widgetId
                    ] = value;

                  }

                }
              );


              return next;

            }
          );

        }


        return result;

      },
      [
        writePLC,
      ]
    );


  // ==========================================================
  // GET VALUE
  // ==========================================================

  const getValue =
    useCallback(
      ({
        widgetId,
        device,
        addressType,
        address,
      }) => {

        // ------------------------------------------------------
        // WIDGET ID FIRST
        // ------------------------------------------------------

        if (
          widgetId !== undefined &&
          widgetId !== null
        ) {

          const widgetValue =
            values[
              String(widgetId)
            ];


          if (
            widgetValue !== undefined
          ) {

            return widgetValue;

          }

        }


        // ------------------------------------------------------
        // PHYSICAL ADDRESS SECOND
        // ------------------------------------------------------

        if (
          device &&
          address !== undefined &&
          address !== null
        ) {

          const key =
            createAddressKey(
              device,
              addressType,
              address
            );


          return values[key];

        }


        return undefined;

      },
      [
        values,
      ]
    );


  // ==========================================================
  // GET CONNECTION STATUS
  // ==========================================================

  const getConnectionStatus =
    useCallback(
      ({
        device,
        addressType,
        address,
      }) => {

        if (!device) {
          return false;
        }


        const key =
          createAddressKey(
            device,
            addressType,
            address
          );


        return (
          connectionStatus[key] ===
          true
        );

      },
      [
        connectionStatus,
      ]
    );


  // ==========================================================
  // GET ERROR
  // ==========================================================

  const getError =
    useCallback(
      ({
        device,
        addressType,
        address,
      }) => {

        if (!device) {
          return null;
        }


        const key =
          createAddressKey(
            device,
            addressType,
            address
          );


        return (
          errors[key] ||
          null
        );

      },
      [
        errors,
      ]
    );


  // ==========================================================
  // NORMALIZED DEVICES
  // ==========================================================

  const normalizedDevices =
    Array.isArray(devices)
      ? devices
          .map(
            normalizeDevice
          )
          .filter(Boolean)
      : [];


  // ==========================================================
  // RETURN
  // ==========================================================

  return {

    values,

    tcpValues:
      values,

    connectionStatus,

    errors,

    devices:
      normalizedDevices,

    registerBinding,

    unregisterBinding,

    clearBindings,

    readPLC,

    readBatchPLC,

    writePLC,

    writeValue,

    getValue,

    getConnectionStatus,

    getError,

    poll,

  };
}


// ============================================================
// DEFAULT EXPORT
// ============================================================

export default useTCPPLC;