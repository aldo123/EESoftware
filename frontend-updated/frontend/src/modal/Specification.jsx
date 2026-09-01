// src/modal/Specification.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API } from "../service/api";

const EMPTY_ROW = {
  parameter_test: "",
  lower_limit: "",
  upper_limit: "",

  trigger_start: "TCP",
  trigger_device: "",
  trigger_register_type: "Holding",
  trigger_source: "",

  time_start: 1,
  time_stop: 10,
  method: "Avg",

  data_source: "TCP",
  source_device: "",
  source_register_type: "Holding",
  source: "",
};

const TRIGGER_START_OPTIONS = [
  { value: "TCP", label: "TCP" },
  { value: "Internal", label: "Internal" },
  { value: "Realtime", label: "Realtime" },
];

const REGISTER_OPTIONS = [
  { value: "Holding", label: "Holding" },
  { value: "Coil", label: "Coil" },
  { value: "Discrete Input", label: "discrate Input" },
  { value: "Input Register", label: "input register" },
];

const METHOD_OPTIONS = [
  { value: "Avg", label: "Avg" },
  { value: "Min", label: "Min" },
  { value: "Max", label: "Max" },
];

const DATA_SOURCE_OPTIONS = [
  { value: "TCP", label: "TCP" },
  { value: "internal", label: "internal" },
  { value: "RS232", label: "RS232" },
];

function uid() {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function newRow() {
  return { id: uid(), ...EMPTY_ROW };
}

function normalizeRow(row = {}) {
  return {
    ...EMPTY_ROW,
    ...row,
    id: row.id ?? uid(),
  };
}

function normalizeSpecification(spec = {}) {
  return {
    ...spec,
    rows: Array.isArray(spec.rows)
      ? spec.rows.map(normalizeRow)
      : [],
  };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `API returned non-JSON response (${response.status}) from ${url}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

function FieldLabel({ children }) {
  return (
    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder = "",
  disabled = false,
}) {
  return (
    <input
      type={type}
      step="any"
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-primary)] outline-none focus:border-[#22C55E] disabled:opacity-50"
    />
  );
}

function Select({ value, onChange, options, disabled = false }) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-1.5 text-[10px] text-[var(--text-primary)] outline-none focus:border-[#22C55E] disabled:opacity-50"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default function Specification({ onClose }) {
  const [specifications, setSpecifications] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [current, setCurrent] = useState(null);

  const [tcpDevices, setTcpDevices] = useState([]);
  const [rs232Devices, setRs232Devices] = useState([]);
  const [internalVariables, setInternalVariables] = useState([]);

  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testRunning, setTestRunning] = useState({});
  const [testResults, setTestResults] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadDevices = useCallback(async () => {
    const results = await Promise.allSettled([
      jsonRequest(`${API}/api/tcp/devices`),
      jsonRequest(`${API}/api/rs232/devices`),
      jsonRequest(`${API}/api/internal-variables`),
    ]);

    if (results[0].status === "fulfilled") {
      setTcpDevices(
        Array.isArray(results[0].value?.devices)
          ? results[0].value.devices
          : []
      );
    }

    if (results[1].status === "fulfilled") {
      setRs232Devices(
        Array.isArray(results[1].value?.devices)
          ? results[1].value.devices
          : []
      );
    }

    if (results[2].status === "fulfilled") {
      setInternalVariables(
        Array.isArray(results[2].value?.variables)
          ? results[2].value.variables
          : []
      );
    }
  }, []);

  const loadSpecifications = useCallback(async (selectId = null) => {
    setLoading(true);
    setError("");

    try {
      const data = await jsonRequest(`${API}/api/specifications`);
      const list = Array.isArray(data?.specifications)
        ? data.specifications.map(normalizeSpecification)
        : [];

      setSpecifications(list);

      const wanted = selectId ?? selectedId;
      const selected =
        list.find((item) => String(item.id) === String(wanted)) ||
        list[0] ||
        null;

      setSelectedId(selected ? String(selected.id) : "");
      setCurrent(selected ? normalizeSpecification(selected) : null);
    } catch (err) {
      setError(err.message || "Failed to load specifications");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadSpecifications(null);
    loadDevices();
  }, [loadSpecifications, loadDevices]);

  function updateCurrent(patch) {
    setCurrent((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateRow(rowId, patch) {
    setCurrent((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        rows: prev.rows.map((row) =>
          String(row.id) === String(rowId)
            ? { ...row, ...patch }
            : row
        ),
      };
    });
  }

  function addParameter() {
    setCurrent((prev) =>
      prev
        ? { ...prev, rows: [...prev.rows, newRow()] }
        : prev
    );
  }

  function deleteParameter(rowId) {
    setCurrent((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.filter(
              (row) => String(row.id) !== String(rowId)
            ),
          }
        : prev
    );
  }

  async function createSpecification() {
    const name = newName.trim();

    if (!name) {
      setError("Specification name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await jsonRequest(`${API}/api/specifications`, {
        method: "POST",
        body: JSON.stringify({
          name,
          rows: [],
        }),
      });

      setCreateOpen(false);
      setNewName("");

      await loadSpecifications(data?.specification?.id ?? null);
      setMessage(`Specification "${name}" created.`);
    } catch (err) {
      setError(err.message || "Failed to create specification");
    } finally {
      setSaving(false);
    }
  }

  async function saveSpecification() {
    if (!current) return;

    if (!String(current.name || "").trim()) {
      setError("Specification name is required.");
      return;
    }

    for (const row of current.rows) {
      if (!String(row.parameter_test || "").trim()) {
        setError("Parameter Test cannot be empty.");
        return;
      }

      const start = Number(row.time_start);
      const stop = Number(row.time_stop);

      if (!Number.isFinite(start) || !Number.isFinite(stop)) {
        setError(
          `Invalid time for "${row.parameter_test}".`
        );
        return;
      }

      if (stop < start) {
        setError(
          `Time Stop must be >= Time Start for "${row.parameter_test}".`
        );
        return;
      }
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        name: current.name.trim(),
        rows: current.rows.map((row) => ({
          parameter_test: row.parameter_test,
          lower_limit:
            row.lower_limit === ""
              ? null
              : Number(row.lower_limit),
          upper_limit:
            row.upper_limit === ""
              ? null
              : Number(row.upper_limit),

          trigger_start: row.trigger_start,
          trigger_device: row.trigger_device,
          trigger_register_type: row.trigger_register_type,
          trigger_source: row.trigger_source,

          time_start: Number(row.time_start),
          time_stop: Number(row.time_stop),
          method: row.method,

          data_source: row.data_source,
          source_device: row.source_device,
          source_register_type: row.source_register_type,
          source: row.source,
        })),
      };

      await jsonRequest(
        `${API}/api/specifications/${current.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );

      await loadSpecifications(current.id);
      setMessage("Specification saved.");
    } catch (err) {
      setError(err.message || "Failed to save specification");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSpecification() {
    if (!current) return;

    if (
      !window.confirm(
        `Delete specification "${current.name}"?`
      )
    ) {
      return;
    }

    try {
      await jsonRequest(
        `${API}/api/specifications/${current.id}`,
        { method: "DELETE" }
      );

      await loadSpecifications(null);
      setMessage("Specification deleted.");
    } catch (err) {
      setError(err.message || "Failed to delete specification");
    }
  }

  async function testRow(row) {
    if (!current) return;

    const rowId = String(row.id);

    setError("");
    setMessage("");
    setTestRunning((prev) => ({
      ...prev,
      [rowId]: true,
    }));

    setTestResults((prev) => ({
      ...prev,
      [rowId]: {
        parameter_test: row.parameter_test,
        status: "waiting_trigger",
        result: null,
        samples: [],
        sample_count: 0,
        time_start: Number(row.time_start) || 0,
        time_stop: Number(row.time_stop) || 0,
        method: row.method || "Avg",
      },
    }));

    try {
      // Test is now asynchronous:
      // click Test -> Waiting Trigger -> Sampling -> PASS/FAIL.
      const data = await jsonRequest(
        `${API}/api/specifications/runtime/test-source`,
        {
          method: "POST",
          body: JSON.stringify({ row }),
        }
      );

      if (!data?.test_id) {
        throw new Error(data?.message || "Test session was not created");
      }

      setMessage(`${row.parameter_test}: Waiting for trigger...`);

      let cancelled = false;

      const poll = async () => {
        if (cancelled) return;

        try {
          const status = await jsonRequest(
            `${API}/api/specifications/runtime/test-source/status/${encodeURIComponent(data.test_id)}`
          );

          if (cancelled) return;

          setTestResults((prev) => ({
            ...prev,
            [rowId]: status,
          }));

          const statusText = String(status?.status || "").toLowerCase();

          if (statusText === "waiting_trigger") {
            setMessage(`${row.parameter_test}: Waiting for trigger...`);
          } else if (statusText === "running") {
            const count = Number(status?.sample_count || 0);
            const elapsed = Number(status?.elapsed_seconds || 0).toFixed(2);
            setMessage(
              `${row.parameter_test}: Sampling... ${elapsed}s · ${count} samples @ 70 ms`
            );
          } else if (
            statusText === "pass" ||
            statusText === "fail" ||
            statusText === "error" ||
            statusText === "stopped"
          ) {
            setTestRunning((prev) => ({
              ...prev,
              [rowId]: false,
            }));

            if (statusText === "pass" || statusText === "fail") {
              const resultText =
                status.result == null
                  ? "-"
                  : Number(status.result).toFixed(3);

              setMessage(
                `${row.parameter_test}: ${status.status} → ${resultText} ` +
                `(${status.sample_count || 0} samples @ 70 ms)`
              );
            } else if (statusText === "error") {
              setError(
                `${row.parameter_test}: ${status.error || "Test failed"}`
              );
            }

            return;
          }

          window.setTimeout(poll, 100);
        } catch (err) {
          if (cancelled) return;

          setTestRunning((prev) => ({
            ...prev,
            [rowId]: false,
          }));

          setTestResults((prev) => ({
            ...prev,
            [rowId]: {
              status: "ERROR",
              error: err.message || "Test failed",
            },
          }));

          setError(`${row.parameter_test}: ${err.message || "Test failed"}`);
        }
      };

      poll();
    } catch (err) {
      setTestRunning((prev) => ({
        ...prev,
        [rowId]: false,
      }));

      setTestResults((prev) => ({
        ...prev,
        [rowId]: {
          status: "ERROR",
          error: err.message || "Test failed",
        },
      }));

      setError(`${row.parameter_test}: ${err.message || "Test failed"}`);
    }
  }

  const tcpNames = useMemo(
    () => tcpDevices.map((d) => d.name).filter(Boolean),
    [tcpDevices]
  );

  const rs232Names = useMemo(
    () => rs232Devices.map((d) => d.name).filter(Boolean),
    [rs232Devices]
  );

  const internalNames = useMemo(
    () => internalVariables.map((v) => v.name).filter(Boolean),
    [internalVariables]
  );

  function updateDataSource(row, value) {
    const patch = { data_source: value };

    if (value === "TCP") {
      patch.source_device = tcpNames[0] || "";
      patch.source_register_type = "Holding";
      patch.source = "";
    } else if (value === "RS232") {
      patch.source_device = rs232Names[0] || "";
      patch.source_register_type = "Holding";
      patch.source = "com device";
    } else {
      patch.source_device = "";
      patch.source_register_type = "Holding";
      patch.source = internalNames[0] || "";
    }

    updateRow(row.id, patch);
  }

  function updateTriggerStart(row, value) {
    const patch = { trigger_start: value };

    if (value === "TCP") {
      patch.trigger_device = tcpNames[0] || "";
      patch.trigger_register_type = "Holding";
      patch.trigger_source = "";
    } else if (value === "Internal") {
      patch.trigger_device = "";
      patch.trigger_register_type = "Holding";
      patch.trigger_source = internalNames[0] || "";
    } else {
      patch.trigger_device = "";
      patch.trigger_register_type = "Holding";
      patch.trigger_source = "";
    }

    updateRow(row.id, patch);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-3">
      <div
        className="w-[98vw] max-w-[1800px] h-[94vh] rounded-2xl border border-[#22C55E]/40 overflow-hidden flex flex-col shadow-2xl"
        style={{ background: "var(--bg-surface-2)" }}
      >
        {/* HEADER */}
        <div className="h-16 shrink-0 px-5 border-b border-[var(--border-soft)] flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-[#22C55E]">
              Specification
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              Specification, device source and test execution
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#DC2626] text-[var(--text-secondary)] hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-hidden">
          {/* SPEC SELECTOR */}
          <div className="shrink-0 rounded-xl border border-[var(--border)] p-3 bg-[var(--bg-elevated)]">
            <div className="flex items-end gap-3">
              <div className="min-w-[300px]">
                <FieldLabel>Specification</FieldLabel>
                <select
                  value={selectedId}
                  onChange={(e) => {
                    const spec = specifications.find(
                      (item) =>
                        String(item.id) === e.target.value
                    );
                    if (spec) {
                      setCurrent(normalizeSpecification(spec));
                      setSelectedId(String(spec.id));
                      setRuntime(null);
                      setRunning(false);
                    }
                  }}
                  className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-primary)]"
                >
                  <option value="">
                    {loading
                      ? "Loading..."
                      : "Select Specification"}
                  </option>

                  {specifications.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => {
                  setCreateOpen(true);
                  setNewName("");
                  setError("");
                }}
                className="h-9 px-4 rounded-lg bg-[#22C55E] text-[#052E16] text-[10px] font-bold"
              >
                + Create Specification
              </button>

              <button
                onClick={loadDevices}
                className="h-9 px-4 rounded-lg border border-[var(--border)] text-[10px] text-[var(--text-secondary)]"
              >
                Refresh Devices
              </button>

              <div className="ml-auto text-[9px] text-[var(--text-muted)]">
                TCP: {tcpDevices.length} · RS232:{" "}
                {rs232Devices.length} · Internal:{" "}
                {internalVariables.length}
              </div>
            </div>

            {createOpen && (
              <div className="mt-3 flex gap-2 items-end">
                <div className="flex-1">
                  <FieldLabel>Specification Name</FieldLabel>
                  <Input
                    value={newName}
                    onChange={setNewName}
                    placeholder="Example: Product A"
                  />
                </div>

                <button
                  onClick={createSpecification}
                  disabled={saving}
                  className="h-8 px-5 rounded-md bg-[#22C55E] text-[#052E16] text-[10px] font-bold disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create"}
                </button>

                <button
                  onClick={() => setCreateOpen(false)}
                  className="h-8 px-4 rounded-md border border-[var(--border)] text-[10px] text-[var(--text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* TABLE */}
          {current ? (
            <div className="flex-1 min-h-0 rounded-xl border border-[var(--border)] overflow-hidden flex flex-col">
              <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] flex items-center">
                <div>
                  <div className="text-sm font-bold text-[#22C55E]">
                    {current.name}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">
                    {current.rows.length} parameter(s)
                  </div>
                </div>

                <div className="ml-auto flex gap-2">
                  <button
                    onClick={addParameter}
                    className="h-8 px-3 rounded-md border border-[#22C55E]/50 text-[#22C55E] text-[10px]"
                  >
                    + Add Parameter
                  </button>

                  <button
                    onClick={saveSpecification}
                    disabled={saving}
                    className="h-8 px-4 rounded-md bg-[#22C55E] text-[#052E16] text-[10px] font-bold disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>

                  <button
                    onClick={deleteSpecification}
                    className="h-8 px-3 rounded-md border border-[#EF4444]/40 text-[#FCA5A5] text-[10px]"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                <table className="border-collapse text-[10px] min-w-[2200px]">
                  <thead className="sticky top-0 z-20 bg-[#1F2937] text-white">
                    <tr>
                      <th className="border border-[var(--border)] p-2 min-w-[150px] text-left">
                        Parameter Test
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[100px] text-left">
                        Lower Limit
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[100px] text-left">
                        Upper Limit
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[125px] text-left">
                        Trigger Start
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[150px] text-left">
                        Device Trigger
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[155px] text-left">
                        Type Register Trigger
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[180px] text-left">
                        Trigger Source
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[90px] text-left">
                        Time Start
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[90px] text-left">
                        Time Stop
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[90px] text-left">
                        Method
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[120px] text-left">
                        Data Source
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[150px] text-left">
                        Device Source
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[155px] text-left">
                        Type Register Source
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[180px] text-left">
                        Source
                      </th>
                      <th className="border border-[var(--border)] p-2 min-w-[70px] text-white font-bold">
                        Test
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {current.rows.map((row) => {
                      const triggerInternal =
                        row.trigger_start === "Internal";
                      const triggerTcp =
                        row.trigger_start === "TCP";

                      const sourceTcp =
                        row.data_source === "TCP";
                      const sourceInternal =
                        row.data_source === "internal";
                      const sourceRs232 =
                        row.data_source === "RS232";

                      return (
                        <tr key={row.id} className="align-top">
                          <td className="border border-[var(--border-soft)] p-1">
                            <Input
                              value={row.parameter_test}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  parameter_test: value,
                                })
                              }
                              placeholder="Temperature"
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Input
                              type="number"
                              value={row.lower_limit}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  lower_limit: value,
                                })
                              }
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Input
                              type="number"
                              value={row.upper_limit}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  upper_limit: value,
                                })
                              }
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Select
                              value={row.trigger_start}
                              onChange={(value) =>
                                updateTriggerStart(row, value)
                              }
                              options={TRIGGER_START_OPTIONS}
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            {triggerTcp ? (
                              <Select
                                value={row.trigger_device}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    trigger_device: value,
                                  })
                                }
                                options={[
                                  {
                                    value: "",
                                    label: "Select PLC",
                                  },
                                  ...tcpNames.map((name) => ({
                                    value: name,
                                    label: name,
                                  })),
                                ]}
                              />
                            ) : (
                              <Input
                                value={row.trigger_device}
                                disabled
                                placeholder="—"
                                onChange={() => {}}
                              />
                            )}
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Select
                              value={row.trigger_register_type}
                              disabled={!triggerTcp}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  trigger_register_type: value,
                                })
                              }
                              options={REGISTER_OPTIONS}
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            {triggerInternal ? (
                              <Select
                                value={row.trigger_source}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    trigger_source: value,
                                  })
                                }
                                options={[
                                  {
                                    value: "",
                                    label: "Select variable",
                                  },
                                  ...internalNames.map((name) => ({
                                    value: name,
                                    label: name,
                                  })),
                                ]}
                              />
                            ) : (
                              <Input
                                value={row.trigger_source}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    trigger_source: value,
                                  })
                                }
                                placeholder={
                                  triggerTcp
                                    ? "0 / D100 / address"
                                    : "—"
                                }
                                disabled={
                                  row.trigger_start === "Realtime"
                                }
                              />
                            )}
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Input
                              type="number"
                              value={row.time_start}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  time_start: value,
                                })
                              }
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Input
                              type="number"
                              value={row.time_stop}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  time_stop: value,
                                })
                              }
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Select
                              value={row.method}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  method: value,
                                })
                              }
                              options={METHOD_OPTIONS}
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Select
                              value={row.data_source}
                              onChange={(value) =>
                                updateDataSource(row, value)
                              }
                              options={DATA_SOURCE_OPTIONS}
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            {sourceTcp ? (
                              <Select
                                value={row.source_device}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    source_device: value,
                                  })
                                }
                                options={[
                                  {
                                    value: "",
                                    label: "Select PLC",
                                  },
                                  ...tcpNames.map((name) => ({
                                    value: name,
                                    label: name,
                                  })),
                                ]}
                              />
                            ) : sourceRs232 ? (
                              <Select
                                value={row.source_device}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    source_device: value,
                                  })
                                }
                                options={[
                                  {
                                    value: "",
                                    label: "Select COM",
                                  },
                                  ...rs232Names.map((name) => ({
                                    value: name,
                                    label: name,
                                  })),
                                ]}
                              />
                            ) : (
                              <Input
                                value=""
                                disabled
                                placeholder="—"
                                onChange={() => {}}
                              />
                            )}
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <Select
                              value={row.source_register_type}
                              disabled={!sourceTcp}
                              onChange={(value) =>
                                updateRow(row.id, {
                                  source_register_type: value,
                                })
                              }
                              options={REGISTER_OPTIONS}
                            />
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            {sourceInternal ? (
                              <Select
                                value={row.source}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    source: value,
                                  })
                                }
                                options={[
                                  {
                                    value: "",
                                    label: "Select variable",
                                  },
                                  ...internalNames.map((name) => ({
                                    value: name,
                                    label: name,
                                  })),
                                ]}
                              />
                            ) : sourceRs232 ? (
                              <Input
                                value={row.source || "com device"}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    source: value,
                                  })
                                }
                                placeholder="com device"
                              />
                            ) : (
                              <Input
                                value={row.source}
                                onChange={(value) =>
                                  updateRow(row.id, {
                                    source: value,
                                  })
                                }
                                placeholder="Modbus address"
                              />
                            )}
                          </td>

                          <td className="border border-[var(--border-soft)] p-1">
                            <div className="flex flex-col gap-1 min-w-[120px]">
                              <button
                                onClick={() => testRow(row)}
                                disabled={Boolean(testRunning[String(row.id)])}
                                className="h-8 px-2 rounded-md border border-[#22C55E]/50 text-[#22C55E] text-[9px] disabled:opacity-50"
                              >
                                {testRunning[String(row.id)] ? "Testing..." : "Test"}
                              </button>

                              {testResults[String(row.id)] && (
                                <div
                                  className={
                                    ["PASS"].includes(
                                      String(testResults[String(row.id)]?.status || "").toUpperCase()
                                    )
                                      ? "rounded-md border border-[#22C55E]/30 bg-[#14532D]/20 px-2 py-1 text-[9px] text-[#86EFAC]"
                                      : ["FAIL", "ERROR", "error"].includes(
                                          String(testResults[String(row.id)]?.status || "")
                                        )
                                      ? "rounded-md border border-[#EF4444]/30 bg-[#7F1D1D]/20 px-2 py-1 text-[9px] text-[#FCA5A5]"
                                      : "rounded-md border border-[#FACC15]/30 bg-[#713F12]/20 px-2 py-1 text-[9px] text-[#FDE68A]"
                                  }
                                >
                                  {(() => {
                                    const result = testResults[String(row.id)];
                                    const status = String(
                                      result?.status || ""
                                    ).toUpperCase();

                                    if (status === "WAITING_TRIGGER") {
                                      return (
                                        <>
                                          <div className="font-bold">
                                            WAITING TRIGGER
                                          </div>
                                          <div>
                                            Waiting for trigger...
                                          </div>
                                        </>
                                      );
                                    }

                                    if (status === "RUNNING") {
                                      return (
                                        <>
                                          <div className="font-bold">
                                            SAMPLING
                                          </div>
                                          <div>
                                            t ={" "}
                                            {Number(
                                              result?.elapsed_seconds || 0
                                            ).toFixed(2)}
                                            s /{" "}
                                            {Number(
                                              result?.time_stop ??
                                                row.time_stop ??
                                                0
                                            ).toFixed(2)}
                                            s
                                          </div>
                                          <div>
                                            {result?.sample_count || 0} samples @ 70 ms
                                          </div>
                                          {result?.last_value != null && (
                                            <div className="font-bold">
                                              Current:{" "}
                                              {Number(
                                                result.last_value
                                              ).toFixed(3)}
                                            </div>
                                          )}
                                        </>
                                      );
                                    }

                                    if (status === "ERROR") {
                                      return (
                                        <div className="truncate">
                                          ERROR: {result?.error || "Test failed"}
                                        </div>
                                      );
                                    }

                                    if (status === "STOPPED") {
                                      return (
                                        <>
                                          <div className="font-bold">
                                            STOPPED
                                          </div>
                                          <div>
                                            {result?.sample_count || 0} samples
                                          </div>
                                        </>
                                      );
                                    }

                                    return (
                                      <>
                                        <div className="font-bold">
                                          {status || "IDLE"}
                                          {result?.result != null &&
                                            ` → ${Number(result.result).toFixed(3)}`}
                                        </div>
                                        <div>
                                          {result?.method || row.method} ·{" "}
                                          {result?.sample_count || 0} samples
                                        </div>
                                        <div>
                                          {Number(
                                            result?.time_start ??
                                              row.time_start ??
                                              0
                                          ).toFixed(2)}
                                          s →{" "}
                                          {Number(
                                            result?.time_stop ??
                                              row.time_stop ??
                                              0
                                          ).toFixed(2)}
                                          s
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}

                              <button
                                onClick={() =>
                                  deleteParameter(row.id)
                                }
                                className="h-8 px-2 rounded-md border border-[#EF4444]/40 text-[#FCA5A5] text-[9px]"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {current.rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={15}
                          className="py-12 text-center text-[var(--text-muted)]"
                        >
                          No parameter. Click{" "}
                          <b className="text-[#22C55E]">
                            + Add Parameter
                          </b>
                          .
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* LIVE TESTING */}
              <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)] p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-bold text-[var(--text-primary)] text-[10px]">
                    Live Testing
                  </span>
                  <span className="text-[9px] text-[var(--text-muted)]">
                    Test → Waiting Trigger → Time Start → Sampling every 70 ms → Time Stop
                  </span>
                </div>

                <div className="flex flex-col gap-1 max-h-28 overflow-auto">
                  {current.rows.map((row) => {
                    const result = testResults[String(row.id)];
                    if (!result) return null;

                    const status = String(result.status || "").toUpperCase();
                    const isWaiting = status === "WAITING_TRIGGER";
                    const isRunning = status === "RUNNING";
                    const isPass = status === "PASS";
                    const isFail = status === "FAIL";
                    const isError = status === "ERROR";

                    return (
                      <div
                        key={`live-${row.id}`}
                        className="flex items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1 text-[9px]"
                      >
                        <span className="font-bold text-[var(--text-primary)] min-w-[110px]">
                          {row.parameter_test || "Parameter"}
                        </span>

                        <span
                          className={
                            isPass
                              ? "font-bold text-[#22C55E]"
                              : isFail || isError
                              ? "font-bold text-[#EF4444]"
                              : "font-bold text-[#FACC15]"
                          }
                        >
                          {status || "IDLE"}
                        </span>

                        {isWaiting && (
                          <span className="text-[#FACC15]">
                            Waiting for trigger...
                          </span>
                        )}

                        {isRunning && (
                          <>
                            <span className="text-[var(--text-secondary)]">
                              t = {Number(result.elapsed_seconds || 0).toFixed(2)}s
                              {" / "}
                              {Number(row.time_stop || 0).toFixed(2)}s
                            </span>
                            <span className="text-[var(--text-secondary)]">
                              Samples: {result.sample_count || 0}
                            </span>
                            {result.last_value != null && (
                              <span className="text-[#60A5FA] font-bold">
                                Current: {Number(result.last_value).toFixed(3)}
                              </span>
                            )}
                          </>
                        )}

                        {(isPass || isFail) && (
                          <>
                            <span className="text-[var(--text-secondary)]">
                              {row.method}:{" "}
                              {result.result == null
                                ? "-"
                                : Number(result.result).toFixed(3)}
                            </span>
                            <span className="text-[var(--text-secondary)]">
                              {result.sample_count || 0} samples
                            </span>
                          </>
                        )}

                        {isError && (
                          <span className="text-[#FCA5A5] truncate">
                            {result.error || "Test failed"}
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {!current.rows.some(
                    (row) => testResults[String(row.id)]
                  ) && (
                    <div className="text-[9px] text-[var(--text-muted)]">
                      No test running. Click <b>Test</b> on a parameter to start.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-xl border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-muted)]">
              Select or create a Specification.
            </div>
          )}

          {message && (
            <div className="shrink-0 rounded-lg border border-[#22C55E]/30 bg-[#14532D]/20 px-3 py-2 text-[10px] text-[#86EFAC]">
              {message}
            </div>
          )}

          {error && (
            <div className="shrink-0 rounded-lg border border-[#EF4444]/30 bg-[#7F1D1D]/20 px-3 py-2 text-[10px] text-[#FCA5A5]">
              {error}
            </div>
          )}
        </div>

        <div className="h-14 shrink-0 px-5 border-t border-[var(--border-soft)] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
