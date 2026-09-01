// src/hooks/useTCPPLC.js
//
// High-performance PLC communication hook.
//
// READ:
//   - Batch polling.
//   - One React state commit per polling cycle.
//   - Duplicate physical addresses are read only once.
//
// WRITE:
//   - Optimistic UI update happens BEFORE network await.
//   - Backend /api/tcp/write returns immediately after queueing.
//   - PLC write itself runs in a persistent Python TCP worker.
//
// The public API is intentionally kept compatible with the previous hook.

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

const DEFAULT_POLL_INTERVAL = 50;


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
// FETCH JSON HELPER
// ============================================================

async function fetchJson(
  url,
  options = {}
) {
  const response = await fetch(
    url,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      `${response.status} ${response.statusText}`
    );
  }

  if (
    data &&
    data.success === false
  ) {
    throw new Error(
      data.message ||
      "PLC request failed."
    );
  }

  return data;
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
  const [errors, setErrors] = useState({});

  const valuesRef = useRef({});
  const connectionStatusRef = useRef({});
  const errorsRef = useRef({});

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

  const pollBusyRef =
    useRef(false);

  // Prevent a stale poll response from overwriting a value that
  // has just been optimistically written.
  const pendingWritesRef =
    useRef(new Map());


  // ==========================================================
  // COMPONENT CAPABILITY
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

    if (component === "button") {
      return (
        type === "coil" ||
        type === "holding_register"
      );
    }

    if (component === "light") {
      return (
        type === "coil" ||
        type === "discrete_input" ||
        type === "holding_register" ||
        type === "input_register"
      );
    }

    if (component === "gauge") {
      return (
        type === "holding_register"
      );
    }

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

        if (
          !Number.isInteger(
            numericAddress
          ) ||
          numericAddress < 0 ||
          numericAddress > 65535
        ) {
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

        bindingsRef.current.set(
          String(widgetId),
          {
            widgetId: String(widgetId),
            widgetType:
              normalizedWidgetType,
            device:
              normalizedDevice,
            addressType: type,
            address: numericAddress,
            key,
          }
        );
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

        if (
          !Number.isInteger(
            numericAddress
          ) ||
          numericAddress < 0 ||
          numericAddress > 65535
        ) {
          throw new Error(
            "Modbus address must be an integer between 0 and 65535."
          );
        }

        const numericCount =
          Number(count) || 1;

        const data =
          await fetchJson(
            `${API}/api/tcp/read`,
            {
              method: "POST",
              body: JSON.stringify({
                device_name:
                  normalizedDevice.name,
                address_type: type,
                address:
                  numericAddress,
                count:
                  numericCount,
              }),
            }
          );

        if (
          data?.value !== undefined
        ) {
          return data.value;
        }

        if (
          Array.isArray(
            data?.values
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
                id: String(
                  item.id ??
                  `${type}:${numericAddress}:${index}`
                ),
                addressType: type,
                address:
                  numericAddress,
              };
            }
          );

        const data =
          await fetchJson(
            `${API}/api/tcp/read-batch`,
            {
              method: "POST",
              body: JSON.stringify({
                device_name:
                  normalizedDevice.name,
                requests:
                  normalizedRequests.map(
                    (item) => ({
                      id: item.id,
                      address_type:
                        item.addressType,
                      address:
                        item.address,
                    })
                  ),
              }),
            }
          );

        return Array.isArray(
          data?.results
        )
          ? data.results
          : [];
      },
      []
    );


  // ==========================================================
  // LOCAL OPTIMISTIC UPDATE
  // ==========================================================

  const applyOptimisticValue =
    useCallback(
      ({
        device,
        addressType,
        address,
        value,
      }) => {

        const normalizedDevice =
          normalizeDevice(device);

        const type =
          normalizeAddressType(
            addressType
          );

        const numericAddress =
          Number(address);

        const key =
          createAddressKey(
            normalizedDevice,
            type,
            numericAddress
          );

        const writeToken =
          Date.now();

        pendingWritesRef.current.set(
          key,
          {
            value,
            token: writeToken,
            timestamp: performance.now(),
          }
        );

        if (!mountedRef.current) {
          return;
        }

        setValues(
          (previous) => {

            const next = {
              ...previous,
              [key]: value,
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

        if (
          !Number.isInteger(
            numericAddress
          ) ||
          numericAddress < 0 ||
          numericAddress > 65535
        ) {
          throw new Error(
            "Modbus address must be an integer between 0 and 65535."
          );
        }

        let writeValueData;

        if (type === "coil") {
          writeValueData =
            (
              value === true ||
              Number(value) === 1
            );
        } else {
          writeValueData =
            Number(value);

          if (
            !Number.isInteger(
              writeValueData
            ) ||
            writeValueData < 0 ||
            writeValueData > 65535
          ) {
            throw new Error(
              "Holding Register value must be 0..65535."
            );
          }
        }

        /*
         * IMPORTANT:
         *
         * The backend now returns HTTP 202 immediately after putting
         * the write in its persistent per-device queue.
         *
         * It no longer waits for PLC response.
         */
        return fetchJson(
          `${API}/api/tcp/write`,
          {
            method: "POST",
            body: JSON.stringify({
              device_name:
                normalizedDevice.name,
              address_type: type,
              address:
                numericAddress,
              value:
                writeValueData,
            }),
          }
        );
      },
      []
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

        /*
         * CRITICAL PERFORMANCE RULE:
         *
         * UI is updated FIRST.
         * The user should never see a button waiting for PLC response.
         */
        applyOptimisticValue({
          device,
          addressType,
          address,
          value,
        });

        try {
          const result =
            await writePLC({
              device,
              addressType,
              address,
              value,
            });

          return result;

        } catch (error) {

          /*
           * Do not block the UI while the PLC is unreachable.
           * Polling will eventually reconcile the state.
           *
           * The error is still surfaced to the caller so existing
           * application-level error handling remains possible.
           */
          console.error(
            "[useTCPPLC] Write queue failed:",
            error
          );

          throw error;
        }
      },
      [
        applyOptimisticValue,
        writePLC,
      ]
    );


  // ==========================================================
  // BATCH WRITE PLC
  // ==========================================================

  const writeBatchPLC =
    useCallback(
      async ({
        writes = [],
      }) => {

        if (
          !Array.isArray(writes) ||
          writes.length === 0
        ) {
          return {
            success: true,
            queued: true,
            count: 0,
            results: [],
          };
        }

        const normalizedWrites =
          writes.map(
            (item, index) => {

              const device =
                normalizeDevice(
                  item.device
                );

              if (!device?.name) {
                throw new Error(
                  `Write ${index}: PLC device is missing.`
                );
              }

              const type =
                normalizeAddressType(
                  item.addressType
                );

              if (
                type !== "coil" &&
                type !== "holding_register"
              ) {
                throw new Error(
                  `Write ${index}: ${type || "Address"} is read-only.`
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
                  `Write ${index}: invalid address.`
                );
              }

              let value;

              if (type === "coil") {
                value =
                  (
                    item.value === true ||
                    Number(item.value) === 1
                  );
              } else {
                value =
                  Number(item.value);

                if (
                  !Number.isInteger(
                    value
                  ) ||
                  value < 0 ||
                  value > 65535
                ) {
                  throw new Error(
                    `Write ${index}: invalid Holding Register value.`
                  );
                }
              }

              return {
                id: String(
                  item.id ??
                  `${device.name}:${type}:${numericAddress}:${index}`
                ),
                device,
                addressType: type,
                address:
                  numericAddress,
                value,
              };
            }
          );

        /*
         * Optimistic update for ALL targets before HTTP.
         */
        normalizedWrites.forEach(
          (item) => {
            applyOptimisticValue({
              device: item.device,
              addressType:
                item.addressType,
              address:
                item.address,
              value:
                item.value,
            });
          }
        );

        const data =
          await fetchJson(
            `${API}/api/tcp/write-batch`,
            {
              method: "POST",
              body: JSON.stringify({
                writes:
                  normalizedWrites.map(
                    (item) => ({
                      id: item.id,
                      device_name:
                        item.device.name,
                      address_type:
                        item.addressType,
                      address:
                        item.address,
                      value:
                        item.value,
                    })
                  ),
              }),
            }
          );

        return data;
      },
      [
        applyOptimisticValue,
      ]
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

        if (pollBusyRef.current) {
          return;
        }

        if (
          bindingsRef.current.size === 0
        ) {
          return;
        }

        pollBusyRef.current = true;

        try {

          // ----------------------------------------------------
          // GROUP UNIQUE PHYSICAL ADDRESSES
          // ----------------------------------------------------

          const grouped =
            new Map();

          bindingsRef.current.forEach(
            (binding) => {

              const normalizedDevice =
                normalizeDevice(
                  binding.device
                );

              if (!normalizedDevice?.name) {
                return;
              }

              const type =
                normalizeAddressType(
                  binding.addressType
                );

              const numericAddress =
                Number(binding.address);

              if (
                !type ||
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
                  type,
                  numericAddress
                );

              if (!grouped.has(key)) {
                grouped.set(
                  key,
                  {
                    key,
                    device:
                      normalizedDevice,
                    addressType:
                      type,
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
          // GROUP BY DEVICE
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

              if (
                !deviceBatches.has(
                  deviceKey
                )
              ) {
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


          // ----------------------------------------------------
          // READ DEVICES IN PARALLEL
          // ----------------------------------------------------

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
                          String(
                            result.id
                          ),
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
                        String(
                          group.key
                        )
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


                    /*
                     * If a write was just queued, do not allow an old
                     * polling snapshot to visually undo the optimistic
                     * button state.
                     *
                     * Once PLC polling sees the requested value, the
                     * pending marker is removed.
                     */
                    const pending =
                      pendingWritesRef.current.get(
                        group.key
                      );

                    if (pending) {

                      if (
                        Object.is(
                          value,
                          pending.value
                        )
                      ) {
                        pendingWritesRef.current.delete(
                          group.key
                        );

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

                      } else {

                        /*
                         * Keep optimistic value while the queued write
                         * is still settling.
                         */
                        nextValues[
                          group.key
                        ] = pending.value;

                        for (
                          const binding
                          of group.bindings
                        ) {
                          nextValues[
                            binding.widgetId
                          ] =
                            pending.value;
                        }
                      }

                    } else {

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
          pollBusyRef.current =
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

      /*
       * Immediate first read.
       */
      poll();

      /*
       * Keep existing behavior but never allow an interval tick
       * to overlap a previous poll.
       */
      timerRef.current =
        setInterval(
          poll,
          Math.max(
            50,
            Number(
              pollInterval
            ) ||
            DEFAULT_POLL_INTERVAL
          )
        );

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
          connectionStatus[key] === true
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
    writeBatchPLC,

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
