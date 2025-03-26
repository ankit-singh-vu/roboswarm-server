#!/bin/sh

source /root/myenv/bin/activate
# Disable ipv6
echo "Disabling IPv6"
sysctl -w net.ipv6.conf.all.disable_ipv6=1
sysctl -w net.ipv6.conf.default.disable_ipv6=1

# Go to /root
cd /root

# Set ready and ip for this machine
MYIP=$(ip -o route get to 8.8.8.8 | sed -n 's/.*src \([0-9.]\+\).*/\1/p')
ISREADYBODY=$(cat <<-END
    {
        "action": "is_ready",
        "ip_address": "${MYIP}"
    }
END
)
echo "Setting ready and IP: ${MYIP}"
curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d "$ISREADYBODY" > /dev/null

# Enable the firewall
echo "y" | ufw enable

# Open the firewall for SSh
echo "Opening firewall for SSH"
ufw allow ssh

# Open the firewall for Locust
echo "Opening firewall for Locust"
ufw allow 8000:65535/tcp
ufw allow 5557/tcp
ufw allow 5558/tcp
curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"port_open_complete"}' > /dev/null

# Increase open file limit.
ulimit -n 200000
sysctl -w fs.file-max=200000

# Wait for apt to become available.
while sudo fuser /var/{lib/{dpkg,apt/lists},cache/apt/archives}/lock >/dev/null 2>&1; do
   sleep 1
done

# Install necessary packages
export DEBIAN_FRONTEND=noninteractive && apt update
export DEBIAN_FRONTEND=noninteractive && apt upgrade -y
export DEBIAN_FRONTEND=noninteractive && apt-get install -y python3-pip wget unzip traceroute emacs

# Download the template file and unzip
echo "Downloading and unzipping load test template"
wget {{baseUrl}}/api/v1/public/machine/{{machineId}}/template
unzip -o template
curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"file_transfer_complete"}'

# Update dependency install flag
echo "Updating dependency_install_complete"
curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"dependency_install_complete"}' > /dev/null

# Master Group
echo "Checking if this machine is master"
ISMASTER=$(curl {{baseUrl}}/api/v1/public/machine/{{machineId}}/is-master)
if [ "$ISMASTER" = "true" ]; then
   # Download the data watch script
   echo "Downloading data watch script"
   wget {{baseUrl}}/api/v1/public/machine/{{machineId}}/data-watch
   mv data-watch data_watch.py

   # Start master
   echo "Starting master"
   ulimit -n 200000 && PYTHONWARNINGS="ignore:Unverified HTTPS request" nohup locust --master --csv=status --host={{hostUrl}} --users={{users}} --spawn-rate={{rate}} --run-time={{runTime}} --headless --expect-workers={{expectSlaveCount}} &
   curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"master_started_complete"}' > /dev/null
   curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"setup_complete"}' > /dev/null

   # Start data watch
   echo "Start data watch"
   PYTHONWARNINGS="ignore:Unverified HTTPS request" nohup python3 data_watch.py {{baseUrl}} {{machineId}} {{basePath}} &
fi

# Slave Group
if [ "$ISMASTER" = "false" ]; then

   # Wait for master to be ready.
   while [ $(curl {{baseUrl}}/api/v1/public/machine/{{machineId}}/is-master-started) = "false" ]; do
      sleep 2
      echo "Master not started. Waiting 2 seconds."
   done

   # Get the master IP
   echo "Master started. Starting Locust worker."
   MASTERIP=$(curl {{baseUrl}}/api/v1/public/machine/{{machineId}}/master-ip)

   # Start 2 workers per machine.
   for VARIABLE in 1 2
   do
      ulimit -n 200000 && PYTHONWARNINGS="ignore:Unverified HTTPS request" locust --worker --master-host=$MASTERIP --logfile=/root/locustlog.log --loglevel=debug &
   done

   # Mark machine as ready.
   echo "Updating setup_complete for: ${MYIP}"
   curl -X POST {{baseUrl}}/api/v1/public/machine/{{machineId}}/status -H 'Content-Type: application/json' -d '{"action":"setup_complete"}' > /dev/null
fi

echo "Done with initialization."