#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

console.error('[MCP LaundryConnect] Starting server initialization');

const server = new McpServer({
    name: "mcp-laundryconnect",
    version: "1.0.0"
});

console.error('[MCP LaundryConnect] Server instance created');

const API_URL = process.env.WASHING_MACHINE_API_URL;
const ORGANIZATION_ID = process.env.ALLIANCELS_ORGANIZATION_ID;

async function getMachineStatus() {
    try {
        console.error('[MCP LaundryConnect] Starting API request to:', API_URL);
        
        if (typeof fetch === 'undefined') {
            throw new Error('fetch is not available. Please use Node.js v18 or later.');
        }
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-GB,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'alliancels-organization-id': ORGANIZATION_ID,
            'Origin': 'https://wa.sqinsights.com',
            'Referer': 'https://wa.sqinsights.com/',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site'
        };

        console.error('[MCP LaundryConnect] Request headers prepared');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(API_URL, {
            method: 'GET',
            headers: headers,
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.error('[MCP LaundryConnect] Response status:', response.status);
        console.error('[MCP LaundryConnect] Response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[MCP LaundryConnect] Error response body:', errorText);
            throw new Error(`API request failed with status ${response.status}: ${errorText}`);
        }

        const responseText = await response.text();
        console.error('[MCP LaundryConnect] Raw response (first 500 chars):', responseText.substring(0, 500));
        
        let data;
        try {
            data = JSON.parse(responseText);
            console.error('[MCP LaundryConnect] Successfully parsed JSON response');
        } catch (parseError) {
            console.error('[MCP LaundryConnect] JSON parse error:', parseError.message);
            console.error('[MCP LaundryConnect] Response content type:', response.headers.get('content-type'));
            throw new Error(`Failed to parse JSON response: ${parseError.message}. Response was: ${responseText.substring(0, 200)}`);
        }

        const machines = data.map((machine, index) => {
            const machineInfo = {
                id: machine.id,
                name: machine.machineName,
                type: machine.machineType.isWasher ? 'Washer' : 'Dryer',
                status: 'Unknown',
                remainingMinutes: 0,
                cycle: 'Unknown',
                doorOpen: false,
                statusParsed: false
            };

            try {
                const status = JSON.parse(machine.currentStatus);
                machineInfo.status = status.statusId;
                machineInfo.remainingMinutes = Math.ceil(status.remainingSeconds / 60);
                machineInfo.cycle = status.selectedCycle?.name || 'Unknown';
                machineInfo.doorOpen = status.isDoorOpen;
                machineInfo.statusParsed = true;
            } catch (error) {
                console.error(`[MCP LaundryConnect] Error parsing status for machine ${machine.id}:`, error.message);
                machineInfo.statusError = error.message;
            }

            return machineInfo;
        });

        const inUseMachines = machines.filter(machine => machine.status === 'IN_USE');
        const summary = {
            totalMachines: machines.length,
            currentlyInUse: inUseMachines.length,
            available: machines.length - inUseMachines.length,
            timestamp: new Date().toISOString()
        };

        console.error('[MCP LaundryConnect] Successfully processed data:', summary);

        return {
            success: true,
            summary,
            machines
        };

    } catch (error) {
        console.error('[MCP LaundryConnect] Error in getMachineStatus:', error.message);
        console.error('[MCP LaundryConnect] Full error:', error);
        
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

async function washingMachineStatus() {
    console.error('[MCP LaundryConnect] washingMachineStatus called');
    const result = await getMachineStatus();
    
    console.error('[MCP LaundryConnect] Returning result:', JSON.stringify(result, null, 2));
    
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
}

server.registerTool("washing_machine_status", {
    title: "Get washing machine status",
    description: "Get the current status of all washing machines and dryers in the laundry facility.",
    inputSchema: {},
}, washingMachineStatus);

console.error('[MCP LaundryConnect] Tool registered successfully');

const transport = new StdioServerTransport();
console.error('[MCP LaundryConnect] Transport created, attempting to connect');

try {
    await server.connect(transport);
    console.error('[MCP LaundryConnect] Server connected successfully');
} catch (error) {
    console.error('[MCP LaundryConnect] Failed to connect server:', error);
    process.exit(1);
}