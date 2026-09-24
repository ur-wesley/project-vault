--!strict
-- signals.luau — minimal Solid-style reactivity for plugins.
-- Embedded by the Rust engine (include_str!) and installed per plugin VM.
-- Per-plugin isolation: roots keyed by plugin id, dispose() on unload/disable.
--
-- API:
--   local count, setCount = createSignal(0)
--   local store, setStore = createStore({ items = {} })  -- path-based, no proxies
--   local doubled = createMemo(function() return count() * 2 end)
--   createEffect(function() print(count()) end)  -- re-runs on dependency change
--   batch(function() setCount(1); setCount(2) end)  -- single flush
--   disposePluginSignals(pluginId)  -- called by engine on unload

local roots: { [string]: any } = {}
local currentObserver: any = nil
local batchDepth = 0
local pendingEffects: { any } = {}
local nextSignalId = 0

local function currentRoot(pluginId: string)
	local r = roots[pluginId]
	if not r then
		r = { signals = {}, effects = {} }
		roots[pluginId] = r
	end
	return r
end

local function scheduleEffect(eff: any)
	if eff.disposed then
		return
	end
	for _, e in pendingEffects do
		if e == eff then
			return
		end
	end
	table.insert(pendingEffects, eff)
	if batchDepth == 0 then
		local queue = pendingEffects
		pendingEffects = {}
		for _, e in queue do
			if not e.disposed then
				e:run()
			end
		end
	end
end

local Signal = {}
Signal.__index = Signal

function Signal:get()
	if currentObserver ~= nil then
		currentObserver:track(self)
	end
	return self.value
end

function Signal:set(newValue: any)
	if self.value ~= newValue then
		self.value = newValue
		self.version += 1
		local subs = {}
		for _, eff in self.subscribers do
			table.insert(subs, eff)
		end
		for _, eff in subs do
			scheduleEffect(eff)
		end
	end
end

local Effect = {}
Effect.__index = Effect

function Effect:track(sig: any)
	self.deps[sig] = true
	sig.subscribers[self] = true
end

function Effect:untrackAll()
	for sig, _ in self.deps do
		sig.subscribers[self] = nil
	end
	self.deps = {}
end

function Effect:run()
	if self.disposed then
		return
	end
	self:untrackAll()
	local prev = currentObserver
	currentObserver = self
	local ok, err = pcall(self.fn)
	currentObserver = prev
	if not ok then
		-- Surface via vault.log when available, never crash the VM.
		local ok2, v = pcall(function()
			return (require :: any)("vault")
		end)
		if ok2 and v ~= nil and v.log ~= nil then
			pcall(function()
				v.log.error("signal effect error: " .. tostring(err))
			end)
		end
	end
end

function Effect:dispose()
	self.disposed = true
	self:untrackAll()
end

local function createSignal(pluginId: string, initial: any)
	nextSignalId += 1
	local sig = setmetatable({
		id = nextSignalId,
		value = initial,
		version = 0,
		subscribers = {},
		pluginId = pluginId,
	}, Signal)
	local root = currentRoot(pluginId)
	root.signals[sig.id] = sig
	local function get()
		return sig:get()
	end
	local function set(v: any)
		sig:set(v)
	end
	return get, set, sig
end

local function createEffect(pluginId: string, fn: () -> ())
	local eff = setmetatable({
		fn = fn,
		deps = {},
		disposed = false,
		pluginId = pluginId,
	}, Effect)
	local root = currentRoot(pluginId)
	table.insert(root.effects, eff)
	eff:run()
	return function()
		eff:dispose()
	end
end

local function createMemo(pluginId: string, fn: () -> any)
	local get, set, _sig = createSignal(pluginId, nil)
	createEffect(pluginId, function()
		set(fn())
	end)
	return get
end

local function batch(fn: () -> ())
	batchDepth += 1
	local ok, err = pcall(fn)
	batchDepth -= 1
	if batchDepth == 0 and #pendingEffects > 0 then
		local queue = pendingEffects
		pendingEffects = {}
		for _, e in queue do
			if not e.disposed then
				e:run()
			end
		end
	end
	if not ok then
		error(err)
	end
end

local function disposePluginSignals(pluginId: string)
	local root = roots[pluginId]
	if root then
		for _, eff in root.effects do
			(eff :: any):dispose()
		end
		roots[pluginId] = nil
	end
end

return {
	createSignal = createSignal,
	createEffect = createEffect,
	createMemo = createMemo,
	batch = batch,
	disposePluginSignals = disposePluginSignals,
	roots = roots,
}
