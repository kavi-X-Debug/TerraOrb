#!/usr/bin/env bash
# Update the TerraOrb backend on the EC2 server after new changes were pushed to GitHub:
#   cd ~/TerraOrb && git pull && sudo bash deploy/ec2/setup.sh
# (setup.sh is safe to run again: it keeps the database in /var/lib/terraorb and only refreshes the code and data.)
cd "$(dirname "$0")/../.." && git pull && sudo bash deploy/ec2/setup.sh
