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
// NORMALIZE MODBUS ADDRESS TYPE
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

  /*
   * Device bisa berasal dari:
   *
   * MainPage
   * setting.json
   * /api/tcp/devices
   */

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
// CREATE UNIQUE ADDRESS KEY
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

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [values, setValues] = useState({});

  const [connectionStatus, setConnectionStatus] =
    useState({});

  const [errors, setErrors] =
    useState({});


  // ----------------------------------------------------------
  // REFS
  // ----------------------------------------------------------

  const bindingsRef =
    useRef(new Map());

  const timerRef =
    useRef(null);

  const mountedRef =
    useRef(false);

  const busyRef =
    useRef(false);


  // ==========================================================
  // REGISTER WIDGET
  // ==========================================================

  const registerBinding = useCallback(
    ({
      widgetId,
      device,
      addressType,
      address,
    }) => {

      if (!widgetId) {
        return;
      }

      if (!device) {
        return;
      }

      const normalizedDevice =
        normalizeDevice(device);

      if (!normalizedDevice?.name) {
        return;
      }

      if (!normalizedDevice?.host) {
        return;
      }

      const numericAddress =
        Number(address);

      if (!Number.isFinite(numericAddress)) {
        return;
      }

      const type =
        normalizeAddressType(addressType);

      if (!type) {
        return;
      }

      const key =
        createAddressKey(
          normalizedDevice,
          type,
          numericAddress
        );

      bindingsRef.current.set(
        String(widgetId),
        {
          widgetId: String(widgetId),
          device: normalizedDevice,
          addressType: type,
          address: numericAddress,
          key,
        }
      );
    },
    []
  );


  // ==========================================================
  // UNREGISTER WIDGET
  // ==========================================================

  const unregisterBinding =
    useCallback((widgetId) => {

      if (!widgetId) {
        return;
      }

      bindingsRef.current.delete(
        String(widgetId)
      );

    }, []);


  // ==========================================================
  // CLEAR ALL
  // ==========================================================

  const clearBindings =
    useCallback(() => {

      bindingsRef.current.clear();

    }, []);


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
          normalizeAddressType(addressType);

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


        /*
         * IMPORTANT
         *
         * Backend tcp_ip.py expects:
         *
         * device_name
         * address_type
         * address
         * count
         */

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


        if (!response.ok) {

          throw new Error(
            `PLC read HTTP ${response.status}`
          );

        }


        const data =
          await response.json();


        if (!data.success) {

          throw new Error(
            data.message ||
            "PLC read failed."
          );

        }


        /*
         * Backend returns:
         *
         * value
         *
         * or:
         *
         * values[]
         */

        if (
          data.value !== undefined
        ) {

          return data.value;

        }


        if (
          Array.isArray(data.values)
        ) {

          return data.values;

        }


        return null;
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

        if (!normalizedDevice.host) {
          throw new Error(
            `PLC IP address is missing for ${normalizedDevice.name}.`
          );
        }

        const type =
          normalizeAddressType(addressType);


        /*
         * Only these two are writable:
         *
         * Coil
         * Holding Register
         */

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

                value,
              }),
            }
          );


        if (!response.ok) {

          throw new Error(
            `PLC write HTTP ${response.status}`
          );

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

          /*
           * Group identical addresses.
           *
           * Example:
           *
           * Gauge 1 → HR30
           * Gauge 2 → HR30
           *
           * Only one request.
           */

          const grouped =
            new Map();


          bindingsRef.current.forEach(
            (binding) => {

              if (
                !grouped.has(
                  binding.key
                )
              ) {

                grouped.set(
                  binding.key,
                  binding
                );

              }

            }
          );


          const requests =
            Array.from(
              grouped.values()
            );


          await Promise.all(
            requests.map(
              async (binding) => {

                try {

                  const value =
                    await readPLC({
                      device:
                        binding.device,

                      addressType:
                        binding.addressType,

                      address:
                        binding.address,

                      count: 1,
                    });


                  if (
                    !mountedRef.current
                  ) {
                    return;
                  }


                  /*
                   * Save by widget ID
                   */

                  setValues(
                    (previous) => ({
                      ...previous,

                      [binding.widgetId]:
                        value,

                      [binding.key]:
                        value,
                    })
                  );


                  /*
                   * Connection OK
                   */

                  setConnectionStatus(
                    (previous) => ({
                      ...previous,

                      [binding.key]:
                        true,
                    })
                  );


                  /*
                   * Remove previous error
                   */

                  setErrors(
                    (previous) => {

                      const next = {
                        ...previous,
                      };

                      delete next[
                        binding.key
                      ];

                      return next;

                    }
                  );

                }

                catch (error) {

                  if (
                    !mountedRef.current
                  ) {
                    return;
                  }


                  setConnectionStatus(
                    (previous) => ({
                      ...previous,

                      [binding.key]:
                        false,
                    })
                  );


                  setErrors(
                    (previous) => ({
                      ...previous,

                      [binding.key]:
                        error?.message ||
                        "PLC communication error.",
                    })
                  );

                }

              }
            )
          );

        }

        finally {

          busyRef.current = false;

        }

      },
      [
        enabled,
        readPLC,
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
       * Read immediately.
       */

      poll();


      /*
       * Then periodic polling.
       */

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


        /*
         * Update UI immediately.
         */

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


          setValues(
            (previous) => ({
              ...previous,

              [String(widgetId)]:
                value,

              [key]:
                value,
            })
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

        /*
         * First priority:
         * widget ID.
         */

        if (
          widgetId !== undefined &&
          widgetId !== null &&
          values[
            String(widgetId)
          ] !== undefined
        ) {

          return values[
            String(widgetId)
          ];

        }


        /*
         * Second priority:
         * Device + Type + Address.
         */

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
  // CONNECTION STATUS
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
  // ERROR
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
          .map(normalizeDevice)
          .filter(Boolean)
      : [];


  // ==========================================================
  // RETURN
  // ==========================================================

  return {

    // Raw values
    values,

    // Communication status
    connectionStatus,

    // Communication errors
    errors,

    // Devices from MainPage / Setting
    devices:
      normalizedDevices,

    // Binding
    registerBinding,
    unregisterBinding,
    clearBindings,

    // Direct Modbus operations
    readPLC,
    writePLC,
    writeValue,

    // Helpers
    getValue,
    getConnectionStatus,
    getError,

    // Manual polling
    poll,
  };
}


// ============================================================
// DEFAULT EXPORT
// ============================================================
//
// This allows BOTH:
//
// import { useTCPPLC } from "../hooks/useTCPPLC";
//
// AND:
//
// import useTCPPLC from "../hooks/useTCPPLC";
//
// ============================================================

export default useTCPPLC;